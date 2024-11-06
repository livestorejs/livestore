/* eslint-disable no-var */

interface Window {
  [key: `__debug${string}`]: any
}

var __debugLiveStore: any
var __debugDownloadBlob: any

interface ImportMeta {
  readonly env: ImportMetaEnv
}
