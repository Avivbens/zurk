import * as cp from 'node:child_process'
import process from 'node:process'
import EventEmitter from 'node:events'
import { Readable, Writable, Stream, Transform } from 'node:stream'
import { assign, noop } from './util.js'

export * from './util.js'

export type TSpawnError = any

export type TSpawnResult = {
  stderr:   string
  stdout:   string
  stdall:   string,
  stdio:    [Readable | Writable, Writable, Writable]
  status:   number | null
  signal:   NodeJS.Signals | null
  duration: number
  ctx:      TSpawnCtxNormalized
  error?:   TSpawnError,
  child?:   TChild
}

export type TSpawnListeners = {
  start:    (data: TChild, ctx: TSpawnCtxNormalized) => void
  stdout:   (data: Buffer, ctx: TSpawnCtxNormalized) => void
  stderr:   (data: Buffer, ctx: TSpawnCtxNormalized) => void
  abort:    (error: Event, ctx: TSpawnCtxNormalized) => void
  err:      (error: Error, ctx: TSpawnCtxNormalized) => void
  end:      (result: TSpawnResult, ctx: TSpawnCtxNormalized) => void
}

export type TSpawnCtx = Partial<Omit<TSpawnCtxNormalized, 'child'>>

export type TChild = ReturnType<typeof cp.spawn>

export type TInput = string | Buffer | Stream

export interface TSpawnCtxNormalized {
  id:         string,
  cwd:        string
  cmd:        string
  sync:       boolean
  args:       ReadonlyArray<string>
  input:      TInput | null
  stdio:      ['pipe', 'pipe', 'pipe']
  detached:   boolean
  env:        Record<string, string | undefined>
  ee:         EventEmitter
  on:         Partial<TSpawnListeners>
  ac:         AbortController
  shell:      string | true | undefined
  spawn:      typeof cp.spawn
  spawnSync:  typeof cp.spawnSync
  spawnOpts:  Record<string, any>
  callback:   (err: TSpawnError, result: TSpawnResult) => void
  stdin:      Readable
  stdout:     Writable
  stderr:     Writable
  child?:     TChild
  fulfilled?: TSpawnResult
  error?:     any
  run:        (cb: () => void, ctx: TSpawnCtxNormalized) => void
}

export const normalizeCtx = (...ctxs: TSpawnCtx[]): TSpawnCtxNormalized => assign({
  id:         Math.random().toString(36).slice(2),
  cmd:        '',
  cwd:        process.cwd(),
  sync:       false,
  args:       [],
  input:      null,
  env:        process.env,
  ee:         new EventEmitter(),
  ac:         new AbortController(),
  on:         {},
  detached:   true,
  shell:      true,
  spawn:      cp.spawn,
  spawnSync:  cp.spawnSync,
  spawnOpts:  {},
  callback:   noop,
  stdin:      new VoidWritable(),
  stdout:     new VoidWritable(),
  stderr:     new VoidWritable(),
  stdio:      ['pipe', 'pipe', 'pipe'],
  run:        setImmediate,
}, ...ctxs)

export const processInput = (child: TChild, input?: TInput | null) => {
  if (input && child.stdin && !child.stdin.destroyed) {
    if (input instanceof Stream) {
      input.pipe(child.stdin)
    } else {
      child.stdin.write(input)
      child.stdin.end()
    }
  }
}

export class VoidWritable extends Transform {
  _transform(chunk: any, _: string, cb: (err?: Error) => void) {
    this.emit('data', chunk)
    cb()
  }
}

export const buildSpawnOpts = ({spawnOpts, stdio, cwd, shell, input, env, detached, ac: {signal}}: TSpawnCtxNormalized) => ({
  ...spawnOpts,
  env,
  cwd,
  stdio,
  shell,
  input: input as string | Buffer,
  windowsHide: true,
  detached,
  signal
})

export const attachListeners = (ee: EventEmitter, on: Partial<TSpawnListeners> = {}) => {
  for (const [name, listener] of Object.entries(on)) {
    ee.on(name, listener as any)
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export const invoke = (c: TSpawnCtxNormalized): TSpawnCtxNormalized => {
  const now = Date.now()
  const stdio: TSpawnResult['stdio'] = [c.stdin, c.stdout, c.stderr]

  try {
    if (c.sync) {
      attachListeners(c.ee, c.on)
      const opts = buildSpawnOpts(c)
      const result = c.spawnSync(c.cmd, c.args, opts)
      c.ee.emit('start', result, c)
      if (result.stdout.length > 0) {
        c.stdout.write(result.stdout)
        c.ee.emit('stdout', result.stdout, c)
      }
      if (result.stderr.length > 0) {
        c.stderr.write(result.stderr)
        c.ee.emit('stderr', result.stderr, c)
      }
      c.callback(null, c.fulfilled = {
        ...result,
        stdout:   result.stdout.toString(),
        stderr:   result.stderr.toString(),
        stdio,
        get stdall() { return this.stdout + this.stderr },
        duration: Date.now() - now,
        ctx:      c
      })
      c.ee.emit('end', c.fulfilled, c)

    } else {
      c.run(() => {
        attachListeners(c.ee, c.on)

        let error: any = null
        const opts = buildSpawnOpts(c)
        const stderr: string[] = []
        const stdout: string[] = []
        const stdall: string[] = []
        const child = c.spawn(c.cmd, c.args, opts)
        c.child = child

        c.ee.emit('start', child, c)

        opts.signal.addEventListener('abort', event => {
          if (opts.detached && child.pid) {
            try {
              // https://github.com/nodejs/node/issues/51766
              process.kill(-child.pid)
            } catch {
              child.kill()
            }
          }
          c.ee.emit('abort', event, c)
        })
        processInput(child, c.input || c.stdin)

        child.stdout.pipe(c.stdout).on('data', d => {
          stdout.push(d)
          stdall.push(d)
          c.ee.emit('stdout', d, c)
        })
        child.stderr.pipe(c.stderr).on('data', d => {
          stderr.push(d)
          stdall.push(d)
          c.ee.emit('stderr', d, c)
        })
        child
          .on('error', (e: any) => {
            error = e
            c.ee.emit('err', error, c)
          })
          .on('close', (status, signal) => {
            c.callback(error, c.fulfilled = {
              error,
              status,
              signal,
              stdout:   stdout.join(''),
              stderr:   stderr.join(''),
              stdall:   stdall.join(''),
              stdio:    [c.stdin, c.stdout, c.stderr],
              duration: Date.now() - now,
              ctx:      c
            })
            c.ee.emit('end', c.fulfilled, c)
          })
      }, c)
    }
  } catch (error: unknown) {
    c.callback(
      error,
      c.fulfilled ={
        error,
        status:   null,
        signal:   null,
        stdout:   '',
        stderr:   '',
        stdall:   '',
        stdio,
        duration: Date.now() - now,
        ctx:      c
      }
    )
    c.ee.emit('err', error, c)
    c.ee.emit('end', c.fulfilled, c)
  }

  return c
}

export const exec = (ctx: TSpawnCtx): TSpawnCtxNormalized => invoke(normalizeCtx(ctx))

// https://2ality.com/2018/05/child-process-streams.html
