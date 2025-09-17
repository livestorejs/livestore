// TODO bring back when Vite limitation is resolved https://github.com/vitejs/vite/issues/8427
// declare module '*?sharedworker' {
//   const sharedWorkerConstructor: {
//     new (options?: { name?: string }): SharedWorker
//   }
//   export default sharedWorkerConstructor
// }

declare interface ImportMetaEnv {
  readonly SSR?: string | boolean
  readonly DEV: boolean | undefined
  readonly VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT: boolean | undefined
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare var __debugLiveStoreUtils: any

declare var LIVESTORE_DEVTOOLS_PATH: string | undefined
