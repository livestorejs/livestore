/// <reference lib="webworker" />

import * as Browser from '../BrowserError.ts'
import { Effect, Option } from '../index.ts'

export class Opfs extends Effect.Service<Opfs>()('@livestore/utils/Opfs', {
  effect: Effect.gen(function* () {
    const getRootDirectoryHandle = Effect.tryPromise({
      try: () => navigator.storage.getDirectory(),
      catch: (u) => Browser.parseBrowserError(u, [Browser.SecurityError]),
    })

    const getFileHandle = (parent: FileSystemDirectoryHandle, name: string, options?: FileSystemGetFileOptions) =>
      Effect.tryPromise({
        try: () => parent.getFileHandle(name, options),
        catch: (u) =>
          Browser.parseBrowserError(u, [
            Browser.NotAllowedError,
            Browser.TypeError,
            Browser.TypeMismatchError,
            Browser.NotFoundError,
          ]),
      })

    const getDirectoryHandle = (
      parent: FileSystemDirectoryHandle,
      name: string,
      options?: FileSystemGetDirectoryOptions,
    ) =>
      Effect.tryPromise({
        try: () => parent.getDirectoryHandle(name, options),
        catch: (u) =>
          Browser.parseBrowserError(u, [
            Browser.NotAllowedError,
            Browser.TypeError,
            Browser.TypeMismatchError,
            Browser.NotFoundError,
          ]),
      })

    const removeEntry = (parent: FileSystemDirectoryHandle, name: string, options?: FileSystemRemoveOptions) =>
      Effect.tryPromise({
        try: () => parent.removeEntry(name, options),
        catch: (u) =>
          Browser.parseBrowserError(u, [
            Browser.TypeError,
            Browser.NotAllowedError,
            Browser.InvalidModificationError,
            Browser.NotFoundError,
          ]),
      })

    const listEntries = (directory: FileSystemDirectoryHandle) =>
      Effect.gen(function* () {
        const entries: (
          | {
              readonly name: string
              readonly kind: 'directory'
              readonly handle: FileSystemDirectoryHandle
            }
          | {
              readonly name: string
              readonly kind: 'file'
              readonly handle: FileSystemFileHandle
            }
          | {
              readonly name: string
              readonly kind: Exclude<FileSystemHandleKind, 'file' | 'directory'>
              readonly handle: FileSystemHandle
            }
        )[] = []

        return yield* Effect.tryPromise({
          try: async () => {
            for await (const [name, handle] of directory) {
              if (handle.kind === 'file') {
                entries.push({ name, kind: 'file', handle: handle as FileSystemFileHandle })
              } else if (handle.kind === 'directory') {
                entries.push({ name, kind: 'directory', handle: handle as FileSystemDirectoryHandle })
              } else {
                entries.push({
                  name,
                  kind: handle.kind,
                  handle,
                })
              }
            }
            return entries
          },
          catch: (u) => Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.NotFoundError]),
        })
      })

    const resolve = (parent: FileSystemDirectoryHandle, child: FileSystemHandle) =>
      Effect.tryPromise({
        try: () => parent.resolve(child),
        catch: (u) => Browser.parseBrowserError(u),
      }).pipe(Effect.map((path) => (path === null ? Option.none() : Option.some(path))))

    const getFile = (handle: FileSystemFileHandle) =>
      Effect.tryPromise({
        try: () => handle.getFile(),
        catch: (u) => Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.NotFoundError]),
      })

    const writeFile = (
      handle: FileSystemFileHandle,
      data: BufferSource | Blob | string,
      options?: FileSystemCreateWritableOptions,
    ) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable(options),
          catch: (u) =>
            Browser.parseBrowserError(u, [
              Browser.NotAllowedError,
              Browser.NotFoundError,
              Browser.NoModificationAllowedError,
              Browser.AbortError,
            ]),
        }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.write(data),
            catch: (u) =>
              Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.QuotaExceededError, Browser.TypeError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseBrowserError(u, [Browser.TypeError]),
          }).pipe(Effect.orElse(() => Effect.void)),
      )

    const appendToFile = (handle: FileSystemFileHandle, data: BufferSource | Blob | string) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable({ keepExistingData: true }),
          catch: (u) =>
            Browser.parseBrowserError(u, [
              Browser.NotAllowedError,
              Browser.NotFoundError,
              Browser.NoModificationAllowedError,
              Browser.AbortError,
            ]),
        }),
        (stream) =>
          Effect.gen(function* () {
            const file = yield* getFile(handle)
            yield* Effect.tryPromise({
              try: () => stream.seek(file.size),
              catch: (u) => Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.TypeError]),
            })
            yield* Effect.tryPromise({
              try: () => stream.write(data),
              catch: (u) =>
                Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.QuotaExceededError, Browser.TypeError]),
            })
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseBrowserError(u, [Browser.TypeError]),
          }).pipe(Effect.orElse(() => Effect.void)),
      )

    const truncateFile = (handle: FileSystemFileHandle, size: number) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable({ keepExistingData: true }),
          catch: (u) =>
            Browser.parseBrowserError(u, [
              Browser.NotAllowedError,
              Browser.NotFoundError,
              Browser.NoModificationAllowedError,
              Browser.AbortError,
            ]),
        }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.truncate(size),
            catch: (u) =>
              Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.TypeError, Browser.QuotaExceededError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseBrowserError(u, [Browser.TypeError]),
          }).pipe(Effect.orElse(() => Effect.void)),
      )

    // Sync Access Handle Operations (Dedicated Workers Only)
    // Note: Sync Access Handles are only available in Dedicated Workers
    // See: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
    const createSyncAccessHandle = (handle: FileSystemFileHandle) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => handle.createSyncAccessHandle(),
          catch: (u) =>
            Browser.parseBrowserError(u, [
              Browser.NotAllowedError,
              Browser.InvalidStateError,
              Browser.NotFoundError,
              Browser.NoModificationAllowedError,
            ]),
        }),
        (syncHandle) => Effect.sync(() => syncHandle.close()).pipe(Effect.orElse(() => Effect.void)),
      )

    const syncRead = (handle: FileSystemSyncAccessHandle, buffer: ArrayBuffer, options?: FileSystemReadWriteOptions) =>
      Effect.try({
        try: () => {
          const view = new Uint8Array(buffer)
          return handle.read(view, options)
        },
        catch: (u) => Browser.parseBrowserError(u, [Browser.RangeError, Browser.InvalidStateError, Browser.TypeError]),
      })

    const syncWrite = (handle: FileSystemSyncAccessHandle, buffer: ArrayBuffer, options?: FileSystemReadWriteOptions) =>
      Effect.try({
        try: () => {
          const view = new Uint8Array(buffer)
          return handle.write(view, options)
        },
        catch: (u) => Browser.parseBrowserError(u),
      })

    const syncTruncate = (handle: FileSystemSyncAccessHandle, size: number) =>
      Effect.try({
        try: () => handle.truncate(size),
        catch: (u) => Browser.parseBrowserError(u),
      })

    const syncGetSize = (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.getSize(),
        catch: (u) => Browser.parseBrowserError(u),
      })

    const syncFlush = (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.flush(),
        catch: (u) => Browser.parseBrowserError(u),
      })

    return {
      getRootDirectoryHandle,
      getFileHandle,
      getDirectoryHandle,
      removeEntry,
      listEntries,
      resolve,
      getFile,
      writeFile,
      appendToFile,
      truncateFile,
      createSyncAccessHandle,
      syncRead,
      syncWrite,
      syncTruncate,
      syncGetSize,
      syncFlush,
    } as const
  }),
}) {}
