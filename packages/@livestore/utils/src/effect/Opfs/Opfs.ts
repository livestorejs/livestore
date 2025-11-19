/// <reference lib="webworker" />

import { Effect, Option, Schema, Stream } from 'effect'
import * as Browser from '../WebError.ts'

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
  sync: () => {
    /**
     * Acquire the OPFS root directory handle.
     *
     * @returns Root directory handle for the current origin.
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory | MDN Reference}
     */
    const getRootDirectoryHandle = Effect.tryPromise({
      try: () => navigator.storage.getDirectory(),
      catch: (u) => Browser.parseWebError(u, [Browser.SecurityError]),
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
          Browser.parseWebError(u, [
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
          Browser.parseWebError(u, [
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
          Browser.parseWebError(u, [
            Browser.TypeError,
            Browser.NotAllowedError,
            Browser.InvalidModificationError,
            Browser.NotFoundError,
            Browser.NoModificationAllowedError,
          ]),
      })

    /**
     * Return a stream of child file-system handles for a directory.
     *
     * @param directory - Directory whose children are to be streamed
     * @returns `Stream` of `FileSystemHandle`
     *
     * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/values | MDN Reference}
     */
    const values = (directory: FileSystemDirectoryHandle) =>
      Stream.fromAsyncIterable(directory.values(), (u) =>
        Browser.parseWebError(u, [Browser.NotAllowedError, Browser.NotFoundError]),
      )

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
        catch: (u) => Browser.parseWebError(u),
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
        catch: (u) => Browser.parseWebError(u, [Browser.NotAllowedError, Browser.NotFoundError]),
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
            Browser.parseWebError(u, [
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
              Browser.parseWebError(u, [Browser.NotAllowedError, Browser.QuotaExceededError, Browser.TypeError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseWebError(u, [Browser.TypeError]),
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
            Browser.parseWebError(u, [
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
              catch: (u) => Browser.parseWebError(u, [Browser.NotAllowedError, Browser.TypeError]),
            })
            yield* Effect.tryPromise({
              try: () => stream.write(data),
              catch: (u) =>
                Browser.parseWebError(u, [Browser.NotAllowedError, Browser.QuotaExceededError, Browser.TypeError]),
            })
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseWebError(u, [Browser.TypeError]),
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
            Browser.parseWebError(u, [
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
              Browser.parseWebError(u, [Browser.NotAllowedError, Browser.TypeError, Browser.QuotaExceededError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => Browser.parseWebError(u, [Browser.TypeError]),
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
            Browser.parseWebError(u, [
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
        catch: (u) => Browser.parseWebError(u, [Browser.RangeError, Browser.InvalidStateError, Browser.TypeError]),
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
        catch: (u) => Browser.parseWebError(u),
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
        catch: (u) => Browser.parseWebError(u),
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
        catch: (u) => Browser.parseWebError(u),
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
        catch: (u) => Browser.parseWebError(u),
      })

    return {
      getRootDirectoryHandle,
      getFileHandle,
      getDirectoryHandle,
      removeEntry,
      values,
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
  },
  accessors: true,
}) {}

const notFoundError = new Browser.NotFoundError({
  cause: new DOMException('The object can not be found here.', 'NotFoundError'),
})

const unknownError = (message: string) => new Browser.UnknownError({ description: message })

/**
 * A no-op Opfs service that can be used for testing.
 */
export const noopOpfs = new Opfs({
  getRootDirectoryHandle: Effect.fail(unknownError('OPFS is not supported in this environment')),
  getFileHandle: () => Effect.fail(notFoundError),
  getDirectoryHandle: () => Effect.fail(notFoundError),
  removeEntry: () => Effect.fail(notFoundError),
  values: () => Effect.fail(notFoundError),
  resolve: () => Effect.succeed(Option.none()),
  getFile: () => Effect.fail(notFoundError),
  writeFile: () => Effect.fail(notFoundError),
  appendToFile: () => Effect.fail(notFoundError),
  truncateFile: () => Effect.fail(notFoundError),
  createSyncAccessHandle: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
  syncRead: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
  syncWrite: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
  syncTruncate: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
  syncGetSize: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
  syncFlush: () => Effect.fail(unknownError('OPFS is not supported in this environment')),
})

/**
 * Error raised when OPFS operations fail.
 */
export class OpfsError extends Schema.TaggedError<OpfsError>()('@livestore/utils/Opfs/Error', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
