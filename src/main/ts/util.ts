export const noop = () => { /* noop */ }

export type PromiseResolve<T = any> = (value: T | PromiseLike<T>) => void

export type TVoidCallback = (...any: any) => void

// https://stackoverflow.com/questions/47423241/replace-fields-types-in-interfaces-to-promises
export type Promisified<T> = {
  [K in keyof T]: T[K] extends (...args: any) => infer R
    ? (...args: Parameters<T[K]>) => Promise<R>
    : Promise<T[K]>
}

export const makeDeferred = <T = any, E = any>(): { promise: Promise<T>, resolve: PromiseResolve<T>, reject: PromiseResolve<E> } => {
  let resolve
  let reject
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise } as any
}

export const isPromiseLike = (value: any): boolean => typeof value?.then === 'function'

export const isStringLiteral = (pieces: any) => pieces?.every?.((p: any) => typeof p === 'string')

export const assign = <T, E>(target: T, ...extras: E[]): T =>
  Object.defineProperties(target, extras.reduce<Record<string, any>>((m: any, extra) =>
    ({...m, ...Object.getOwnPropertyDescriptors(extra)}), {}))

export const quote = (arg: string) => {
  if (/^[\w./:=@-]+$/i.test(arg) || arg === '') {
    return arg
  }

  return (
    `$'` +
    arg
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\f/g, '\\f')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\v/g, '\\v')
      .replace(/\0/g, '\\0') +
    `'`
  )
}

export type TQuote = (input: string) => string

export const buildCmd = (quote: TQuote, pieces: TemplateStringsArray, args: any[], subs = substitute): string | Promise<string> =>  {
  if (args.some(isPromiseLike))
    return Promise.all(args).then((args) => buildCmd(quote, pieces, args))

  let cmd = pieces[0], i = 0
  while (i < args.length) {
    const s = Array.isArray(args[i])
      ? args[i].map((x: any) => quote(substitute(x))).join(' ')
      : quote(substitute(args[i]))

    cmd += s + pieces[++i]
  }

  return cmd
}

export type TSubstitute = (arg: any) => string

export const substitute: TSubstitute = (arg: any) =>
  (typeof arg?.stdout === 'string')
    ? arg.stdout.replace(/\n$/, '')
    : `${arg}`
