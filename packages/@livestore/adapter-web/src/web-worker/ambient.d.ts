// TODO remove OPFS stuff
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
interface FileSystemSyncAccessHandle {
  close: () => void
  flush: () => Promise<void>
  getSize: () => number
  read: (buffer: ArrayBuffer, options?: FileSystemReadWriteOptions) => number
  truncate: (newSize: number) => void
  write: (buffer: ArrayBuffer, options?: FileSystemReadWriteOptions) => number
  seek: (offset: number) => void
}

interface FileSystemReadWriteOptions {
  at?: number
}

interface FileSystemFileHandle {
  createSyncAccessHandle: () => Promise<FileSystemSyncAccessHandle>
}

// TODO bring back when Vite limitation is resolved https://github.com/vitejs/vite/issues/8427
// declare module '*?sharedworker' {
//   const sharedWorkerConstructor: {
//     new (options?: { name?: string }): SharedWorker
//   }
//   export default sharedWorkerConstructor
// }

declare interface ImportMeta {
  env: {
    DEV: boolean | undefined
    VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT: boolean | undefined
  }
}

declare var __debugLiveStoreUtils: any

declare var LIVESTORE_DEVTOOLS_PATH: string | undefined
