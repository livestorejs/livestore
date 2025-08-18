/// <reference lib="dom" />

// TODO remove all unused polyfills once we're closer to the release
globalThis.performance = globalThis.performance ?? {}
globalThis.performance.mark = globalThis.performance.mark ?? (() => {})
globalThis.performance.measure = globalThis.performance.measure ?? (() => {})
globalThis.performance.now = globalThis.performance.now ?? (() => -1)

if (typeof globalThis.location === 'undefined') {
  globalThis.location = {
    href: 'https://worker.cloudflare.com/',
    origin: 'https://worker.cloudflare.com',
    protocol: 'https:',
    host: 'worker.cloudflare.com',
    hostname: 'worker.cloudflare.com',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
  } as Location
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ href: '', pathname: '', search: '', origin: '' }),
    head: { appendChild: () => {} },
  } as any
}

// WeakRef polyfill for Cloudflare Workers
if (typeof WeakRef === 'undefined') {
  // @ts-expect-error
  globalThis.WeakRef = class WeakRef<T> {
    private target: T | undefined

    constructor(target: T) {
      this.target = target
    }

    deref(): T | undefined {
      return this.target
    }
  }
}
