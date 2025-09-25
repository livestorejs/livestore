/// <reference lib="webworker" />

import { Effect, Option, Schema } from 'effect'
import * as Browser from '../BrowserError.ts'

/**
 * Effect service that exposes ergonomic wrappers around Origin Private File System (OPFS) operations.
 *
 * @remarks
 * - Helpers mirror the File System Access API where possible and parse browser exceptions into Effect errors.
 * - Sync access handle helpers can only be used in dedicated workers; invoking them in other contexts fails at runtime.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Origin_private_file_system | MDN Reference}
 */
export class Opfs extends Effect.Service<Opfs>()('@livestore/utils/Opfs', {
  effect: Effect.gen(function* () {
    /**
     * Acquire the OPFS root directory handle.
     *
     * @returns Root directory handle for the current origin.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory | MDN Reference}
     */
    const getRootDirectoryHandle = Effect.tryPromise({
      try: () => navigator.storage.getDirectory(),
      catch: (u) => Browser.parseBrowserError(u, [Browser.SecurityError]),
    })

    /**
     * Resolve (and optionally create) a file handle relative to a directory.
     *
     * @param parent - Directory to search.
     * @param name - Target file name.
     * @param options - Forwarded `getFileHandle` options such as `{ create: true }`.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getFileHandle | MDN Reference}
     */
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

    /**
     * Resolve (and optionally create) a directory handle relative to another directory.
     *
     * @param parent - Directory to search.
     * @param name - Target directory name.
     * @param options - Forwarded `getDirectoryHandle` options such as `{ create: true }`.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getDirectoryHandle | MDN Reference}
     */
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

    /**
     * Remove a file-system entry (file or directory) from its parent directory.
     *
     * @param parent - Directory containing the entry.
     * @param name - Entry name.
     * @param options - Removal behavior (for example `{ recursive: true }`).
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/removeEntry | MDN Reference}
     */
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

    /**
     * Collect a snapshot of child file-system handles for a directory.
     *
     * @param directory - Directory whose entries should be listed.
     * @returns Handles grouped by kind and annotated with names.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/entries | MDN Reference}
     */
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

    /**
     * Resolve the relative path from a parent directory to a descendant handle.
     *
     * @param parent - Reference directory.
     * @param child - File or directory handle within the parent hierarchy.
     * @returns `Option.some(pathSegments)` when reachable, otherwise `Option.none()`.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/resolve | MDN Reference}
     */
    const resolve = (parent: FileSystemDirectoryHandle, child: FileSystemHandle) =>
      Effect.tryPromise({
        try: () => parent.resolve(child),
        catch: (u) => Browser.parseBrowserError(u),
      }).pipe(Effect.map((path) => (path === null ? Option.none() : Option.some(path))))

    /**
     * Read the underlying `File` for a file handle.
     *
     * @param handle - Handle referencing the target file.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/getFile | MDN Reference}
     */
    const getFile = (handle: FileSystemFileHandle) =>
      Effect.tryPromise({
        try: () => handle.getFile(),
        catch: (u) => Browser.parseBrowserError(u, [Browser.NotAllowedError, Browser.NotFoundError]),
      })

    /**
     * Overwrite the contents of a file with the provided data.
     *
     * @param handle - File to write to.
     * @param data - Chunk(s) accepted by `FileSystemWritableFileStream.write`.
     * @param options - Stream creation options (for example `{ keepExistingData: false }`).
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable | MDN Reference}
     */
    const writeFile = (
      handle: FileSystemFileHandle,
      data: FileSystemWriteChunkType,
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

    /**
     * Append data to the end of an existing file.
     *
     * @param handle - File to extend.
     * @param data - Data to append.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream/write | MDN Reference}
     */
    const appendToFile = (handle: FileSystemFileHandle, data: FileSystemWriteChunkType) =>
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

    /**
     * Truncate a file to the specified size in bytes.
     *
     * @param handle - File to shrink or pad.
     * @param size - Target byte length.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream/truncate | MDN Reference}
     */
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

    /**
     * Create a synchronous access handle for a file.
     *
     * @param handle - File handle to open.
     * @returns A managed handle that is automatically closed when released.
     *
     * @remarks
     * - Only available in Dedicated Web Workers.
     * - This method is asynchronous even though the `FileSystemSyncAccessHandle` APIs are synchronous.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle | MDN Reference}
     */
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
        (syncHandle) => Effect.sync(() => syncHandle.close()),
      )

    /**
     * Perform a synchronous read into the provided buffer from a sync access handle.
     *
     * @param handle - Sync access handle to read from.
     * @param buffer - Destination buffer.
     * @param options - Read position options.
     * @returns Number of bytes read.
     *
     * @remarks
     * Only available in Dedicated Web Workers.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/read | MDN Reference}
     */
    const syncRead = (handle: FileSystemSyncAccessHandle, buffer: ArrayBuffer, options?: FileSystemReadWriteOptions) =>
      Effect.try({
        try: () => {
          const view = new Uint8Array(buffer)
          return handle.read(view, options)
        },
        catch: (u) => Browser.parseBrowserError(u, [Browser.RangeError, Browser.InvalidStateError, Browser.TypeError]),
      })

    /**
     * Perform a synchronous write from the provided buffer into the file.
     *
     * @param handle - Sync access handle to write to.
     * @param buffer - Source data.
     * @param options - Write position options.
     * @returns Number of bytes written.
     *
     * @remarks
     * Only available in Dedicated Web Workers.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/write | MDN Reference}
     */
    const syncWrite = (
      handle: FileSystemSyncAccessHandle,
      buffer: AllowSharedBufferSource,
      options?: FileSystemReadWriteOptions,
    ) =>
      Effect.try({
        try: () => handle.write(buffer, options),
        catch: (u) => Browser.parseBrowserError(u),
      })

    /**
     * Truncate the file associated with a sync access handle to the specified size.
     *
     * @param handle - Sync access handle to mutate.
     * @param size - Desired byte length.
     *
     * @remarks
     * Only available in Dedicated Web Workers.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/truncate | MDN Reference}
     */
    const syncTruncate = (handle: FileSystemSyncAccessHandle, size: number) =>
      Effect.try({
        try: () => handle.truncate(size),
        catch: (u) => Browser.parseBrowserError(u),
      })

    /**
     * Retrieve the current size of a file via its sync access handle.
     *
     * @param handle - Sync access handle.
     * @returns File size in bytes.
     *
     * @remarks
     * Only available in Dedicated Web Workers.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/getSize | MDN Reference}
     */
    const syncGetSize = (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.getSize(),
        catch: (u) => Browser.parseBrowserError(u),
      })

    /**
     * Flush pending synchronous writes to durable storage.
     *
     * @param handle - Sync access handle to flush.
     *
     * @remarks
     * Only available in Dedicated Web Workers.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/flush | MDN Reference}
     */
    const syncFlush = (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.flush(),
        catch: (u) => Browser.parseBrowserError(u),
      })

    /**
     * Synchronously write the content of the specified buffer to the file associated with the handle,
     * replacing the file if it already exists.
     *
     * @param handle - Sync access handle to overwrite.
     * @param buffer - Raw data to persist.
     * @returns Effect that resolves once every byte is flushed to durable storage.
     *
     * @remarks
     * - Only available in Dedicated Web Workers.
     * - Crash safety: not atomic. A crash mid-write can leave the file truncated or partially written.
     *   For atomic replacement, prefer `writeFile` or a temp-file copy pattern with two prepared handles.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle | MDN Reference}
     */
    const syncWriteFile = (handle: FileSystemSyncAccessHandle, buffer: AllowSharedBufferSource) => {
      return Effect.gen(function* () {
        const bytes =
          // If it's already a view (e.g., Uint8Array, DataView), wrap its underlying buffer slice.
          ArrayBuffer.isView(buffer)
            ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
            : // If it's a (Shared)ArrayBuffer-like, view the whole buffer.
              new Uint8Array(buffer as ArrayBufferLike)

        // 1) Clear existing contents
        yield* syncTruncate(handle, 0)

        // 2) Write all bytes retrying until the entire buffer is written. `syncWrite()` may write fewer bytes than
        // requested, so we loop until we've written everything or detect no forward progress. This guards against
        // short writes which can occur under quota pressure, buffering limits, or transient errors.
        let offset = 0
        while (offset < bytes.byteLength) {
          const wrote = yield* syncWrite(handle, bytes.subarray(offset), { at: offset })
          if (wrote === 0) {
            // No forward progress -> treat as I/O error / out-of-quota condition.
            return yield* new OpfsError({
              message: `Short write: wrote ${offset} of ${bytes.byteLength} bytes.`,
            })
          }
          offset += Number(wrote)
        }

        // 3) Ensure durability up to this point.
        yield* syncFlush(handle)
      })
    }

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
      syncWriteFile,
    } as const
  }),
}) {}

/**
 * Error raised when OPFS operations fail.
 */
export class OpfsError extends Schema.TaggedError<OpfsError>()('@livestore/utils/Opfs/Error', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
