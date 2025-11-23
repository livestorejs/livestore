/**
 * OPFS Access Handle Pool management service.
 *
 * Manages a pool of OPFS file handles for SQLite VFS operations.
 * Based on https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/AccessHandlePoolVFS.js
 *
 * @module
 */

import { Context, Effect, Layer, Opfs, Schedule, type Scope, Stream, type WebError } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import { DEFAULT_SECTOR_SIZE } from '../../vfs/VfsBackend.ts'
import { VfsError } from '../../vfs/VfsError.ts'

// Each OPFS file begins with a fixed-size header with metadata.
// The contents of the file follow immediately after the header.
const HEADER_MAX_PATH_SIZE = 512
const HEADER_FLAGS_SIZE = 4
const HEADER_DIGEST_SIZE = 8
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
const HEADER_OFFSET_FLAGS = HEADER_MAX_PATH_SIZE
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE

/** Offset where SQLite data starts (after header) */
export const HEADER_OFFSET_DATA = DEFAULT_SECTOR_SIZE

// These file types are expected to persist in the file system outside
// a session. Other files will be removed on VFS start.
const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_SUPER_JOURNAL | VFS.SQLITE_OPEN_WAL

/**
 * Default pool capacity. See OpfsVfs.ts for detailed explanation.
 */
const DEFAULT_CAPACITY = 20

/**
 * Configuration for the OPFS pool.
 */
export interface OpfsPoolConfig {
  /** Directory path in OPFS where files are stored */
  readonly directoryPath: string
  /** Initial pool capacity (default: 20) */
  readonly capacity?: number
}

/**
 * OpfsPool service shape.
 *
 * Manages the pool of OPFS access handles and provides utilities.
 */
export interface OpfsPoolShape {
  // Public utility operations
  /**
   * Get the OPFS file name that contains the data for the given SQLite file.
   * This is the randomly-generated name in the pool, not the SQLite path.
   */
  readonly getOpfsFileName: (path: string) => Effect.Effect<string, VfsError>

  /**
   * Reads the SQLite payload (without the OPFS header) for the given file.
   */
  readonly readFilePayload: (path: string) => Effect.Effect<ArrayBuffer, VfsError>

  /**
   * Reset an access handle by truncating to just the header.
   */
  readonly resetAccessHandle: (path: string) => Effect.Effect<void, VfsError>

  /**
   * Returns the number of SQLite files in the file system.
   */
  readonly getFileCount: () => number

  /**
   * Returns the maximum number of SQLite files the file system can hold.
   */
  readonly getCapacity: () => number

  /**
   * Get all currently tracked SQLite file paths.
   */
  readonly getTrackedFilePaths: () => string[]

  /**
   * Increase the capacity of the file system by n.
   */
  readonly addCapacity: (n: number) => Effect.Effect<void, WebError.WebError | Opfs.OpfsError | VfsError, Scope.Scope>

  /**
   * Decrease the capacity of the file system by n.
   */
  readonly removeCapacity: (n: number) => Effect.Effect<number, WebError.WebError | Opfs.OpfsError>

  /**
   * Release all access handles and close the pool.
   */
  readonly close: () => Effect.Effect<void>

  // Internal methods for VfsBackend implementation
  /**
   * Acquire a handle for the given path. Creates if needed and create=true.
   * @internal
   */
  readonly acquireHandle: (
    path: string,
    flags: number,
    create: boolean,
  ) => Effect.Effect<FileSystemSyncAccessHandle, VfsError>

  /**
   * Release a handle after use. Optionally deletes the file association.
   * @internal
   */
  readonly releaseHandle: (path: string, deleteOnClose: boolean) => Effect.Effect<void, VfsError>

  /**
   * Get the access handle for a path, if it exists.
   * @internal
   */
  readonly getHandleForPath: (path: string) => FileSystemSyncAccessHandle | undefined

  /**
   * Check if a path exists in the pool.
   * @internal
   */
  readonly pathExists: (path: string) => boolean
}

/**
 * OpfsPool service tag.
 *
 * Manages the pool of OPFS access handles for SQLite VFS operations.
 */
export class OpfsPool extends Context.Tag('@livestore/sqlite-wasm/OpfsPool')<OpfsPool, OpfsPoolShape>() {}

/**
 * Convert a bare filename, path, or URL to a UNIX-style path.
 */
const getPath = (nameOrURL: string | URL): string => {
  const url = typeof nameOrURL === 'string' ? new URL(nameOrURL, 'file://localhost/') : nameOrURL
  return url.pathname
}

/**
 * Compute a synchronous digest for the corpus.
 * Adapted from https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
const computeDigest = (corpus: Uint8Array): Uint32Array => {
  if (!corpus[0]) {
    // Optimization for deleted file.
    return new Uint32Array([0xfe_cc_5f_80, 0xac_ce_c0_37])
  }

  let h1 = 0xde_ad_be_ef
  let h2 = 0x41_c6_ce_57

  for (const value of corpus) {
    h1 = Math.imul(h1 ^ value, 2_654_435_761)
    h2 = Math.imul(h2 ^ value, 1_597_334_677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909)

  return new Uint32Array([h1 >>> 0, h2 >>> 0])
}

/**
 * Internal: Create the OpfsPool service implementation.
 */
const makeOpfsPoolService = (
  config: OpfsPoolConfig,
): Effect.Effect<OpfsPoolShape, WebError.WebError | Opfs.OpfsError | VfsError, Opfs.Opfs | Scope.Scope> =>
  Effect.gen(function* () {
    const opfs = yield* Opfs.Opfs

    // All files are stored in a single directory.
    // Note: getDirectoryHandleByPath is a helper function, not a service method
    const directoryHandle = yield* Opfs.getDirectoryHandleByPath(config.directoryPath, { create: true })

    // The OPFS files all have randomly-generated names that do not match
    // the SQLite files whose data they contain.
    const mapAccessHandleToName = new Map<FileSystemSyncAccessHandle, string>()

    // When a SQLite file is associated with an OPFS file, that association
    // is kept in mapPathToAccessHandle. Each access handle is in exactly
    // one of mapPathToAccessHandle or availableAccessHandles.
    const mapPathToAccessHandle = new Map<string, FileSystemSyncAccessHandle>()
    const availableAccessHandles = new Set<FileSystemSyncAccessHandle>()

    /**
     * Read and return the associated path from an OPFS file header.
     * Empty string is returned for an unassociated OPFS file.
     */
    const getAssociatedPath = (accessHandle: FileSystemSyncAccessHandle): Effect.Effect<string, VfsError> =>
      Effect.gen(function* () {
        const corpus = new Uint8Array(HEADER_CORPUS_SIZE)
        yield* Effect.try({
          try: () => accessHandle.read(corpus, { at: 0 }),
          catch: (cause) =>
            new VfsError({
              code: 'Read',
              path: '',
              message: cause instanceof Error ? cause.message : 'Failed to read header',
              cause,
            }),
        })

        const dataView = new DataView(corpus.buffer, corpus.byteOffset)
        const flags = dataView.getUint32(HEADER_OFFSET_FLAGS)
        if (corpus[0] && (flags & VFS.SQLITE_OPEN_DELETEONCLOSE || (flags & PERSISTENT_FILE_TYPES) === 0)) {
          yield* Effect.logWarning(`Remove file with unexpected flags ${flags.toString(16)}`)
          yield* setAssociatedPath(accessHandle, '', 0)
          return ''
        }

        const fileDigest = new Uint32Array(HEADER_DIGEST_SIZE / 4)
        yield* Effect.try({
          try: () => accessHandle.read(fileDigest, { at: HEADER_OFFSET_DIGEST }),
          catch: (cause) =>
            new VfsError({
              code: 'Read',
              path: '',
              message: cause instanceof Error ? cause.message : 'Failed to read digest',
              cause,
            }),
        })

        const computed = computeDigest(corpus)
        if (fileDigest.every((value, i) => value === computed[i])) {
          const pathBytes = corpus.indexOf(0)
          if (pathBytes === 0) {
            yield* Effect.try({
              try: () => accessHandle.truncate(HEADER_OFFSET_DATA),
              catch: (cause) =>
                new VfsError({
                  code: 'Truncate',
                  path: '',
                  message: cause instanceof Error ? cause.message : 'Failed to truncate',
                  cause,
                }),
            })
          }
          return new TextDecoder().decode(corpus.subarray(0, pathBytes))
        } else {
          yield* Effect.logWarning('Disassociating file with bad digest.')
          yield* setAssociatedPath(accessHandle, '', 0)
          return ''
        }
      })

    /**
     * Set the path on an OPFS file header.
     */
    const setAssociatedPath = (
      accessHandle: FileSystemSyncAccessHandle,
      path: string,
      flags: number,
    ): Effect.Effect<void, VfsError> =>
      Effect.gen(function* () {
        const corpus = new Uint8Array(HEADER_CORPUS_SIZE)
        const encodedResult = new TextEncoder().encodeInto(path, corpus)
        if (encodedResult.written! >= HEADER_MAX_PATH_SIZE) {
          return yield* Effect.fail(
            new VfsError({
              code: 'CannotOpen',
              path,
              message: 'path too long',
            }),
          )
        }

        const dataView = new DataView(corpus.buffer, corpus.byteOffset)
        dataView.setUint32(HEADER_OFFSET_FLAGS, flags)

        const digest = computeDigest(corpus)
        yield* Effect.try({
          try: () => accessHandle.write(corpus, { at: 0 }),
          catch: (cause) =>
            new VfsError({
              code: 'Write',
              path,
              message: cause instanceof Error ? cause.message : 'Failed to write header',
              cause,
            }),
        })
        yield* Effect.try({
          try: () => accessHandle.write(digest, { at: HEADER_OFFSET_DIGEST }),
          catch: (cause) =>
            new VfsError({
              code: 'Write',
              path,
              message: cause instanceof Error ? cause.message : 'Failed to write digest',
              cause,
            }),
        })
        yield* Effect.try({
          try: () => accessHandle.flush(),
          catch: (cause) =>
            new VfsError({
              code: 'Sync',
              path,
              message: cause instanceof Error ? cause.message : 'Failed to flush',
              cause,
            }),
        })

        if (path) {
          mapPathToAccessHandle.set(path, accessHandle)
          availableAccessHandles.delete(accessHandle)
        } else {
          yield* Effect.try({
            try: () => accessHandle.truncate(HEADER_OFFSET_DATA),
            catch: (cause) =>
              new VfsError({
                code: 'Truncate',
                path,
                message: cause instanceof Error ? cause.message : 'Failed to truncate',
                cause,
              }),
          })
          availableAccessHandles.add(accessHandle)
        }
      })

    /**
     * Remove the association between a path and an OPFS file.
     */
    const deletePath = (path: string): Effect.Effect<void, VfsError> =>
      Effect.gen(function* () {
        const accessHandle = mapPathToAccessHandle.get(path)
        if (accessHandle) {
          mapPathToAccessHandle.delete(path)
          yield* setAssociatedPath(accessHandle, '', 0)
        }
      })

    /**
     * Acquire all existing access handles from the directory.
     */
    const acquireAccessHandles = (): Effect.Effect<void, WebError.WebError | Opfs.OpfsError | VfsError, Scope.Scope> =>
      Effect.gen(function* () {
        // Instance method returns Stream directly (not wrapped in Effect)
        const handlesStream = opfs.values(directoryHandle)

        yield* handlesStream.pipe(
          Stream.filter((handle): handle is FileSystemFileHandle => handle.kind === 'file'),
          Stream.mapEffect(
            (fileHandle) =>
              Effect.gen(function* () {
                return {
                  opfsFileName: fileHandle.name,
                  accessHandle: yield* opfs.createSyncAccessHandle(fileHandle),
                } as const
              }),
            { concurrency: 'unbounded' },
          ),
          Stream.runForEach(({ opfsFileName, accessHandle }) =>
            Effect.gen(function* () {
              mapAccessHandleToName.set(accessHandle, opfsFileName)
              const associatedPath = yield* getAssociatedPath(accessHandle)

              if (associatedPath) {
                mapPathToAccessHandle.set(associatedPath, accessHandle)
              } else {
                availableAccessHandles.add(accessHandle)
              }
            }),
          ),
        )
      })

    /**
     * Release all access handles.
     */
    const releaseAccessHandles = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.forEach(mapAccessHandleToName.keys(), (accessHandle) => Effect.sync(() => accessHandle.close()), {
          concurrency: 'unbounded',
          discard: true,
        })
        mapAccessHandleToName.clear()
        mapPathToAccessHandle.clear()
        availableAccessHandles.clear()
      })

    /**
     * Add capacity to the pool.
     */
    function addCapacityImpl(
      n: number,
    ): Effect.Effect<void, WebError.WebError | Opfs.OpfsError | VfsError, Scope.Scope> {
      return Effect.repeatN(
        Effect.gen(function* () {
          const name = Math.random().toString(36).replace('0.', '')
          const accessHandle = yield* opfs.getFileHandle(directoryHandle, name, { create: true }).pipe(
            Effect.andThen((handle) => opfs.createSyncAccessHandle(handle)),
            Effect.retry(Schedule.exponentialBackoff10Sec),
          )
          mapAccessHandleToName.set(accessHandle, name)

          yield* setAssociatedPath(accessHandle, '', 0)
        }),
        n - 1,
      )
    }

    // Initialize: acquire existing handles and ensure minimum capacity
    yield* acquireAccessHandles()
    const capacity = config.capacity ?? DEFAULT_CAPACITY
    const currentCapacity = mapAccessHandleToName.size
    if (currentCapacity < capacity) {
      yield* addCapacityImpl(capacity - currentCapacity)
    }

    // Public utility operations
    const getOpfsFileName = (filePath: string): Effect.Effect<string, VfsError> =>
      Effect.gen(function* () {
        const path = getPath(filePath)
        const accessHandle = mapPathToAccessHandle.get(path)
        if (!accessHandle) {
          return yield* Effect.fail(
            new VfsError({
              code: 'FileNotFound',
              path: filePath,
              message: 'File not tracked',
            }),
          )
        }
        const name = mapAccessHandleToName.get(accessHandle)
        if (!name) {
          return yield* Effect.fail(
            new VfsError({
              code: 'Unknown',
              path: filePath,
              message: 'Access handle not found in name map',
            }),
          )
        }
        return name
      })

    const readFilePayload = (filePath: string): Effect.Effect<ArrayBuffer, VfsError> =>
      Effect.gen(function* () {
        const path = getPath(filePath)
        const accessHandle = mapPathToAccessHandle.get(path)

        if (!accessHandle) {
          return yield* Effect.fail(
            new VfsError({
              code: 'FileNotFound',
              path: filePath,
              message: 'Cannot read payload for untracked OPFS path',
            }),
          )
        }

        const fileSize = yield* Effect.try({
          try: () => accessHandle.getSize(),
          catch: (cause) =>
            new VfsError({
              code: 'Read',
              path: filePath,
              message: cause instanceof Error ? cause.message : 'Failed to get file size',
              cause,
            }),
        })

        if (fileSize <= HEADER_OFFSET_DATA) {
          return yield* Effect.fail(
            new VfsError({
              code: 'Read',
              path: filePath,
              message: `OPFS file too small: size ${fileSize} < HEADER_OFFSET_DATA ${HEADER_OFFSET_DATA}`,
            }),
          )
        }

        const payloadSize = fileSize - HEADER_OFFSET_DATA
        const payload = new Uint8Array(payloadSize)
        const bytesRead = yield* Effect.try({
          try: () => accessHandle.read(payload, { at: HEADER_OFFSET_DATA }),
          catch: (cause) =>
            new VfsError({
              code: 'Read',
              path: filePath,
              message: cause instanceof Error ? cause.message : 'Failed to read payload',
              cause,
            }),
        })

        if (bytesRead !== payloadSize) {
          return yield* Effect.fail(
            new VfsError({
              code: 'Read',
              path: filePath,
              message: `Failed to read full payload: read ${bytesRead}/${payloadSize}`,
            }),
          )
        }

        return payload.buffer
      })

    const resetAccessHandleOp = (filePath: string): Effect.Effect<void, VfsError> =>
      Effect.gen(function* () {
        const path = getPath(filePath)
        const accessHandle = mapPathToAccessHandle.get(path)
        if (!accessHandle) {
          return yield* Effect.fail(
            new VfsError({
              code: 'FileNotFound',
              path: filePath,
              message: 'File not tracked',
            }),
          )
        }
        yield* Effect.try({
          try: () => accessHandle.truncate(HEADER_OFFSET_DATA),
          catch: (cause) =>
            new VfsError({
              code: 'Truncate',
              path: filePath,
              message: cause instanceof Error ? cause.message : 'Failed to truncate',
              cause,
            }),
        })
      })

    const addCapacity = (
      n: number,
    ): Effect.Effect<void, WebError.WebError | Opfs.OpfsError | VfsError, Scope.Scope> => addCapacityImpl(n)

    const removeCapacity = (n: number): Effect.Effect<number, WebError.WebError | Opfs.OpfsError> =>
      Effect.gen(function* () {
        let nRemoved = 0
        yield* Effect.forEach(
          availableAccessHandles,
          (accessHandle) =>
            Effect.gen(function* () {
              if (nRemoved === n || mapPathToAccessHandle.size === mapAccessHandleToName.size) return nRemoved

              const name = mapAccessHandleToName.get(accessHandle)!
              accessHandle.close()
              yield* opfs.removeEntry(directoryHandle, name)
              mapAccessHandleToName.delete(accessHandle)
              availableAccessHandles.delete(accessHandle)
              ++nRemoved
            }),
          { concurrency: 'unbounded', discard: true },
        )
        return nRemoved
      })

    // Internal methods for VfsBackend implementation
    const acquireHandle = (
      filePath: string,
      flags: number,
      create: boolean,
    ): Effect.Effect<FileSystemSyncAccessHandle, VfsError> =>
      Effect.gen(function* () {
        const path = filePath ? getPath(filePath) : Math.random().toString(36)
        let accessHandle = mapPathToAccessHandle.get(path)

        if (!accessHandle && create) {
          if (mapPathToAccessHandle.size < mapAccessHandleToName.size) {
            ;[accessHandle] = availableAccessHandles.keys()
            if (!accessHandle) {
              return yield* Effect.fail(
                new VfsError({
                  code: 'CannotOpen',
                  path: filePath,
                  message: 'No available access handles in pool',
                }),
              )
            }
            yield* setAssociatedPath(accessHandle, path, flags)
          } else {
            return yield* Effect.fail(
              new VfsError({
                code: 'CannotOpen',
                path: filePath,
                message: 'Pool capacity exceeded, cannot create file',
              }),
            )
          }
        }

        if (!accessHandle) {
          return yield* Effect.fail(
            new VfsError({
              code: 'FileNotFound',
              path: filePath,
              message: 'File not found',
            }),
          )
        }

        return accessHandle
      })

    const releaseHandle = (filePath: string, deleteOnClose: boolean): Effect.Effect<void, VfsError> =>
      Effect.gen(function* () {
        const path = getPath(filePath)
        const accessHandle = mapPathToAccessHandle.get(path)
        if (accessHandle) {
          yield* Effect.try({
            try: () => accessHandle.flush(),
            catch: (cause) =>
              new VfsError({
                code: 'Close',
                path: filePath,
                message: cause instanceof Error ? cause.message : 'Failed to flush',
                cause,
              }),
          })

          if (deleteOnClose) {
            yield* deletePath(path)
          }
        }
      })

    const getHandleForPath = (filePath: string): FileSystemSyncAccessHandle | undefined => {
      const path = getPath(filePath)
      return mapPathToAccessHandle.get(path)
    }

    const pathExistsOp = (filePath: string): boolean => {
      const path = getPath(filePath)
      return mapPathToAccessHandle.has(path)
    }

    return {
      // Public utilities
      getOpfsFileName,
      readFilePayload,
      resetAccessHandle: resetAccessHandleOp,
      getFileCount: () => mapPathToAccessHandle.size,
      getCapacity: () => mapAccessHandleToName.size,
      getTrackedFilePaths: () => Array.from(mapPathToAccessHandle.keys()),
      addCapacity,
      removeCapacity,
      close: releaseAccessHandles,

      // Internal methods for VfsBackend
      acquireHandle,
      releaseHandle,
      getHandleForPath,
      pathExists: pathExistsOp,
    }
  })

/**
 * Create an OpfsPool layer with the given configuration.
 */
export const makeOpfsPoolLayer = (
  config: OpfsPoolConfig,
): Layer.Layer<OpfsPool, WebError.WebError | Opfs.OpfsError | VfsError, Opfs.Opfs | Scope.Scope> =>
  Layer.effect(OpfsPool, makeOpfsPoolService(config))
