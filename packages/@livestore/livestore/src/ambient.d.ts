interface Window {
  [key: `__debug${string}`]: any
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
