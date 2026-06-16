/// <reference lib="webworker" />

import { Context, Effect, Layer, Option, Schema, type Scope, Stream } from 'effect'

import * as WebError from '../WebError.ts'

/**
 * Effect service that exposes ergonomic wrappers around Origin Private File System (OPFS) operations.
 *
 * @remarks
 * - Helpers mirror the File System Access API where possible and parse web exceptions into Effect errors.
 * - Sync access handle helpers can only be used in dedicated workers; invoking them in other contexts fails at runtime.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Origin_private_file_system | MDN Reference}
 */
export interface Service {
  /**
   * Acquire the OPFS root directory handle.
   *
   * @returns Root directory handle for the current origin.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory | MDN Reference}
   */
  readonly getRootDirectoryHandle: Effect.Effect<FileSystemDirectoryHandle, WebError.WebError>
  /**
   * Resolve (and optionally create) a file handle relative to a directory.
   *
   * @param parent - Directory to search.
   * @param name - Target file name.
   * @param options - Forwarded `getFileHandle` options such as `{ create: true }`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getFileHandle | MDN Reference}
   */
  readonly getFileHandle: (
    parent: FileSystemDirectoryHandle,
    name: string,
    options?: FileSystemGetFileOptions,
  ) => Effect.Effect<FileSystemFileHandle, WebError.WebError>
  /**
   * Resolve (and optionally create) a directory handle relative to another directory.
   *
   * @param parent - Directory to search.
   * @param name - Target directory name.
   * @param options - Forwarded `getDirectoryHandle` options such as `{ create: true }`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getDirectoryHandle | MDN Reference}
   */
  readonly getDirectoryHandle: (
    parent: FileSystemDirectoryHandle,
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ) => Effect.Effect<FileSystemDirectoryHandle, WebError.WebError>
  /**
   * Remove a file-system entry (file or directory) from its parent directory.
   *
   * @param parent - Directory containing the entry.
   * @param name - Entry name.
   * @param options - Removal behavior (for example `{ recursive: true }`).
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/removeEntry | MDN Reference}
   */
  readonly removeEntry: (
    parent: FileSystemDirectoryHandle,
    name: string,
    options?: FileSystemRemoveOptions,
  ) => Effect.Effect<void, WebError.WebError>
  /**
   * Return a stream of child file-system handles for a directory.
   *
   * @param directory - Directory whose children are to be streamed
   * @returns `Stream` of `FileSystemHandle`
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/values | MDN Reference}
   */
  readonly values: (
    directory: FileSystemDirectoryHandle,
  ) => Stream.Stream<FileSystemHandle, WebError.NotAllowedError | WebError.NotFoundError | WebError.UnknownError>
  /**
   * Resolve the relative path from a parent directory to a descendant handle.
   *
   * @param parent - Reference directory.
   * @param child - File or directory handle within the parent hierarchy.
   * @returns `Option.some(pathSegments)` when reachable, otherwise `Option.none()`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/resolve | MDN Reference}
   */
  readonly resolve: (
    parent: FileSystemDirectoryHandle,
    child: FileSystemHandle,
  ) => Effect.Effect<Option.Option<ReadonlyArray<string>>, WebError.WebError>
  /**
   * Read the underlying `File` for a file handle.
   *
   * @param handle - Handle referencing the target file.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/getFile | MDN Reference}
   */
  readonly getFile: (handle: FileSystemFileHandle) => Effect.Effect<File, WebError.WebError>
  /**
   * Overwrite the contents of a file with the provided data.
   *
   * @param handle - File to write to.
   * @param data - Chunk(s) accepted by `FileSystemWritableFileStream.write`.
   * @param options - Stream creation options (for example, `{ keepExistingData: false }`).
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable | MDN Reference}
   */
  readonly writeFile: (
    handle: FileSystemFileHandle,
    data: FileSystemWriteChunkType,
    options?: FileSystemCreateWritableOptions,
  ) => Effect.Effect<void, WebError.WebError>
  /**
   * Append data to the end of an existing file.
   *
   * @param handle - File to extend.
   * @param data - Data to append.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream/write | MDN Reference}
   */
  readonly appendToFile: (
    handle: FileSystemFileHandle,
    data: FileSystemWriteChunkType,
  ) => Effect.Effect<void, WebError.WebError>
  /**
   * Truncate a file to the specified size in bytes.
   *
   * @param handle - File to shrink or pad.
   * @param size - Target byte length.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream/truncate | MDN Reference}
   */
  readonly truncateFile: (handle: FileSystemFileHandle, size: number) => Effect.Effect<void, WebError.WebError>
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
  readonly createSyncAccessHandle: (
    handle: FileSystemFileHandle,
  ) => Effect.Effect<FileSystemSyncAccessHandle, WebError.WebError, Scope.Scope>
  /**
   * Perform a synchronous read into the provided buffer from a sync access handle.
   *
   * @param handle - Sync access handle to read from.
   * @param buffer - Destination buffer (can be a specific view like Uint8Array).
   * @param options - Read position options.
   * @returns Number of bytes read.
   *
   * @remarks
   * Only available in Dedicated Web Workers.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/read | MDN Reference}
   */
  readonly syncRead: (
    handle: FileSystemSyncAccessHandle,
    buffer: ArrayBuffer | ArrayBufferView,
    options?: FileSystemReadWriteOptions,
  ) => Effect.Effect<number, WebError.WebError>
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
  readonly syncWrite: (
    handle: FileSystemSyncAccessHandle,
    buffer: AllowSharedBufferSource,
    options?: FileSystemReadWriteOptions,
  ) => Effect.Effect<number, WebError.WebError>
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
  readonly syncTruncate: (handle: FileSystemSyncAccessHandle, size: number) => Effect.Effect<void, WebError.WebError>
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
  readonly syncGetSize: (handle: FileSystemSyncAccessHandle) => Effect.Effect<number, WebError.WebError>
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
  readonly syncFlush: (handle: FileSystemSyncAccessHandle) => Effect.Effect<void, WebError.WebError>
}

export class Opfs extends Context.Service<Opfs, Service>()('@livestore/utils/Opfs') {}

export const layer = Layer.succeed(
  Opfs,
  Opfs.of({
    getRootDirectoryHandle: Effect.tryPromise({
      try: () => navigator.storage.getDirectory(),
      catch: (u) => WebError.parseWebError(u, [WebError.SecurityError]),
    }),
    getFileHandle: (parent: FileSystemDirectoryHandle, name: string, options?: FileSystemGetFileOptions) =>
      Effect.tryPromise({
        try: () => parent.getFileHandle(name, options),
        catch: (u) =>
          WebError.parseWebError(u, [
            WebError.NotAllowedError,
            WebError.TypeError,
            WebError.TypeMismatchError,
            WebError.NotFoundError,
          ]),
      }),
    getDirectoryHandle: (
      parent: FileSystemDirectoryHandle,
      name: string,
      options?: FileSystemGetDirectoryOptions,
    ) =>
      Effect.tryPromise({
        try: () => parent.getDirectoryHandle(name, options),
        catch: (u) =>
          WebError.parseWebError(u, [
            WebError.NotAllowedError,
            WebError.TypeError,
            WebError.TypeMismatchError,
            WebError.NotFoundError,
          ]),
      }),
    removeEntry: (parent: FileSystemDirectoryHandle, name: string, options?: FileSystemRemoveOptions) =>
      Effect.tryPromise({
        try: () => parent.removeEntry(name, options),
        catch: (u) =>
          WebError.parseWebError(u, [
            WebError.TypeError,
            WebError.NotAllowedError,
            WebError.InvalidModificationError,
            WebError.NotFoundError,
            WebError.NoModificationAllowedError,
          ]),
      }),
    values: (
      directory: FileSystemDirectoryHandle,
    ): Stream.Stream<
      FileSystemHandle,
      WebError.NotAllowedError | WebError.NotFoundError | WebError.UnknownError,
      never
    > =>
      Stream.fromAsyncIterable(directory.values(), (u) =>
        WebError.parseWebError(u, [WebError.NotAllowedError, WebError.NotFoundError]),
      ),
    resolve: (parent: FileSystemDirectoryHandle, child: FileSystemHandle) =>
      Effect.tryPromise({
        try: () => parent.resolve(child),
        catch: (u) => WebError.parseWebError(u),
      }).pipe(Effect.map((path) => (path === null ? Option.none() : Option.some(path)))),
    getFile: (handle: FileSystemFileHandle) =>
      Effect.tryPromise({
        try: () => handle.getFile(),
        catch: (u) => WebError.parseWebError(u, [WebError.NotAllowedError, WebError.NotFoundError]),
      }),
    writeFile: (
      handle: FileSystemFileHandle,
      data: FileSystemWriteChunkType,
      options?: FileSystemCreateWritableOptions,
    ) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable(options),
          catch: (u) =>
            WebError.parseWebError(u, [
              WebError.NotAllowedError,
              WebError.NotFoundError,
              WebError.NoModificationAllowedError,
              WebError.AbortError,
            ]),
        }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.write(data),
            catch: (u) =>
              WebError.parseWebError(u, [WebError.NotAllowedError, WebError.QuotaExceededError, WebError.TypeError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => WebError.parseWebError(u, [WebError.TypeError]),
          }).pipe(Effect.catchCause(() => Effect.void)),
      ),
    appendToFile: (handle: FileSystemFileHandle, data: FileSystemWriteChunkType) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable({ keepExistingData: true }),
          catch: (u) =>
            WebError.parseWebError(u, [
              WebError.NotAllowedError,
              WebError.NotFoundError,
              WebError.NoModificationAllowedError,
              WebError.AbortError,
            ]),
        }),
        (stream) =>
          Effect.gen(function* () {
            const file = yield* Effect.tryPromise({
              try: () => handle.getFile(),
              catch: (u) => WebError.parseWebError(u, [WebError.NotAllowedError, WebError.NotFoundError]),
            })
            yield* Effect.tryPromise({
              try: () => stream.seek(file.size),
              catch: (u) => WebError.parseWebError(u, [WebError.NotAllowedError, WebError.TypeError]),
            })
            yield* Effect.tryPromise({
              try: () => stream.write(data),
              catch: (u) =>
                WebError.parseWebError(u, [WebError.NotAllowedError, WebError.QuotaExceededError, WebError.TypeError]),
            })
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => WebError.parseWebError(u, [WebError.TypeError]),
          }).pipe(Effect.catchCause(() => Effect.void)),
      ),
    truncateFile: (handle: FileSystemFileHandle, size: number) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => handle.createWritable({ keepExistingData: true }),
          catch: (u) =>
            WebError.parseWebError(u, [
              WebError.NotAllowedError,
              WebError.NotFoundError,
              WebError.NoModificationAllowedError,
              WebError.AbortError,
            ]),
        }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.truncate(size),
            catch: (u) =>
              WebError.parseWebError(u, [WebError.NotAllowedError, WebError.TypeError, WebError.QuotaExceededError]),
          }),
        (stream) =>
          Effect.tryPromise({
            try: () => stream.close(),
            catch: (u) => WebError.parseWebError(u, [WebError.TypeError]),
          }).pipe(Effect.catchCause(() => Effect.void)),
      ),
    createSyncAccessHandle: (handle: FileSystemFileHandle) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => handle.createSyncAccessHandle(),
          catch: (u) =>
            WebError.parseWebError(u, [
              WebError.NotAllowedError,
              WebError.InvalidStateError,
              WebError.NotFoundError,
              WebError.NoModificationAllowedError,
            ]),
        }),
        (syncHandle) => Effect.sync(() => syncHandle.close()),
      ),
    syncRead: (
      handle: FileSystemSyncAccessHandle,
      buffer: ArrayBuffer | ArrayBufferView,
      options?: FileSystemReadWriteOptions,
    ) =>
      Effect.try({
        try: () => handle.read(buffer, options),
        catch: (u) => WebError.parseWebError(u, [WebError.RangeError, WebError.InvalidStateError, WebError.TypeError]),
      }),
    syncWrite: (
      handle: FileSystemSyncAccessHandle,
      buffer: AllowSharedBufferSource,
      options?: FileSystemReadWriteOptions,
    ) =>
      Effect.try({
        try: () => handle.write(buffer, options),
        catch: (u) => WebError.parseWebError(u),
      }),
    syncTruncate: (handle: FileSystemSyncAccessHandle, size: number) =>
      Effect.try({
        try: () => handle.truncate(size),
        catch: (u) => WebError.parseWebError(u),
      }),
    syncGetSize: (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.getSize(),
        catch: (u) => WebError.parseWebError(u),
      }),
    syncFlush: (handle: FileSystemSyncAccessHandle) =>
      Effect.try({
        try: () => handle.flush(),
        catch: (u) => WebError.parseWebError(u),
      }),
  }),
)

const notFoundError = new WebError.NotFoundError({
  cause: new DOMException('The object can not be found here.', 'NotFoundError'),
})

const unknownError = (message: string) => new WebError.UnknownError({ description: message })

/**
 * A no-op Opfs service that can be used for testing.
 */
export const layerNoop = Layer.succeed(Opfs,Opfs.of({
  getRootDirectoryHandle: Effect.fail(unknownError('OPFS is not supported in this environment')),
  getFileHandle: () => Effect.fail(notFoundError),
  getDirectoryHandle: () => Effect.fail(notFoundError),
  removeEntry: () => Effect.fail(notFoundError),
  values: () => Stream.fail(notFoundError),
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
}))

/**
 * Error raised when OPFS operations fail.
 */
export class OpfsError extends Schema.TaggedErrorClass<OpfsError>('~@livestore/utils/OpfsError')('OpfsError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
