// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
interface FileSystemSyncAccessHandle {
  close: () => void
  flush: () => Promise<void>
  getSize: () => number
  read: (buffer: Uint8Array | Uint32Array, options?: FileSystemReadWriteOptions) => number
  truncate: (newSize: number) => void
  write: (buffer: Uint8Array | Uint32Array, options?: FileSystemReadWriteOptions) => number
  seek: (offset: number) => void
}

interface FileSystemReadWriteOptions {
  at?: number
}

interface FileSystemFileHandle {
  createSyncAccessHandle: () => Promise<FileSystemSyncAccessHandle>
}
