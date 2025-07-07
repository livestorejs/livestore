// @ts-expect-error TODO remove when Vite does proper treeshaking during dev
globalThis.$RefreshReg$ = () => {}
// @ts-expect-error TODO remove when Vite does proper treeshaking during dev
globalThis.$RefreshSig$ = () => (type: any) => type

// TODO check if we still need this (maybe conflicts with bun-types?)
// // @ts-expect-error Needed for React
globalThis.process = globalThis.process ?? { env: {} }

globalThis.document = (globalThis as any)?.document ?? {
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  createElement: () => ({
    setAttribute: () => {},
    pathname: '',
    style: {},
  }),
  body: {
    addEventListener: () => {},
  },
  head: {
    appendChild: () => {},
  },
}

globalThis.window = globalThis?.window ?? {
  AnimationEvent: class AnimationEvent {},
  TransitionEvent: class TransitionEvent {},
  addEventListener: () => {},
  location: {
    href: '',
    pathname: '',
  },
  document: globalThis.document,
}

globalThis.HTMLElement = globalThis?.HTMLElement ?? class HTMLElement {}
