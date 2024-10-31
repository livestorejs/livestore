interface Window {
  [key: `__debug${string}`]: any
}

// eslint-disable-next-line no-var
var __debugLiveStore: any

interface ImportMeta {
  readonly env: ImportMetaEnv
}
