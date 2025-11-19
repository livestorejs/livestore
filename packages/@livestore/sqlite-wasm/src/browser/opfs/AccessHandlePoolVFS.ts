// Based on https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/AccessHandlePoolVFS.js
import { Effect, Opfs, Runtime, Schedule, Schema, type Scope, Stream, type WebError } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { FacadeVFS } from '../../FacadeVFS.ts'

const SECTOR_SIZE = 4096

// Each OPFS file begins with a fixed-size header with metadata. The
// contents of the file follow immediately after the header.
const HEADER_MAX_PATH_SIZE = 512
const HEADER_FLAGS_SIZE = 4
const HEADER_DIGEST_SIZE = 8
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
const HEADER_OFFSET_FLAGS = HEADER_MAX_PATH_SIZE
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE
const HEADER_OFFSET_DATA = SECTOR_SIZE

// These file types are expected to persist in the file system outside
// a session. Other files will be removed on VFS start.
const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_SUPER_JOURNAL | VFS.SQLITE_OPEN_WAL

// OPFS file pool capacity must be predicted rather than dynamically increased because
// capacity expansion (addCapacity) is async while SQLite operations are synchronous.
// We cannot await in the middle of sqlite3.step() calls without making the API async.
//
// We over-allocate because:
// 1. SQLite’s temporary file usage is not part of its API contract.
//    Future SQLite versions may create additional temporary files without notice.
//    See: https://www.sqlite.org/tempfiles.html
// 2. In the future, we may change how we operate the SQLite DBs,
//    which may increase the number of files needed.
//    e.g. enabling the WAL mode, using multi-DB transactions, etc.
//
// TRADEOFF: Higher capacity means the VFS opens and keeps more file handles, consuming
// browser resources. Lower capacity risks "SQLITE_CANTOPEN" errors during operations.
//
// CAPACITY CALCULATION:
// - 2 main databases (state + eventlog) × 4 files each (main, journal, WAL, shm) = 8 files
// - Up to 5 SQLite temporary files (super-journal, temp DB, materializations,
//   transient indices, VACUUM temp DB) = 5 files
// - Transient state database archival operations = 1 file
// - Safety buffer for future SQLite versions and unpredictable usage = 6 files
// Total: 20 files
//
// References:
// - https://sqlite.org/forum/info/a3da1e34d8
// - https://www.sqlite.org/tempfiles.html
const DEFAULT_CAPACITY = 20

/**
 * This VFS uses the updated Access Handle API with all synchronous methods
 * on FileSystemSyncAccessHandle (instead of just read and write). It will
 * work with the regular SQLite WebAssembly build, i.e. the one without
 * Asyncify.
 */
export class AccessHandlePoolVFS extends FacadeVFS {
  log = null //function(...args) { console.log(`[${contextName}]`, ...args) };

  // Runtime for executing Effect operations
  #runtime: Runtime.Runtime<Opfs.Opfs | Scope.Scope>

  // All the OPFS files the VFS uses are contained in one flat directory
  // specified in the constructor. No other files should be written here.
  #directoryPath
  #directoryHandle: FileSystemDirectoryHandle | undefined

  // The OPFS files all have randomly-generated names that do not match
  // the SQLite files whose data they contain. This map links those names
  // with their respective OPFS access handles.
  #mapAccessHandleToName = new Map<FileSystemSyncAccessHandle, string>()

  // When a SQLite file is associated with an OPFS file, that association
  // is kept in #mapPathToAccessHandle. Each access handle is in exactly
  // one of #mapPathToAccessHandle or #availableAccessHandles.
  #mapPathToAccessHandle = new Map<string, FileSystemSyncAccessHandle>()
  #availableAccessHandles = new Set<FileSystemSyncAccessHandle>()

  #mapIdToFile = new Map<number, { path: string; flags: number; accessHandle: FileSystemSyncAccessHandle }>()

  static create = Effect.fn(function* (name: string, directoryPath: string, module: any) {
    const runtime = yield* Effect.runtime<Opfs.Opfs | Scope.Scope>()
    const vfs = new AccessHandlePoolVFS({ name, directoryPath, module, runtime })
    yield* Effect.promise(() => vfs.isReady())
    return vfs
  })

  constructor({
    name,
    directoryPath,
    module,
    runtime,
  }: { name: string; directoryPath: string; module: any; runtime: Runtime.Runtime<Opfs.Opfs | Scope.Scope> }) {
    super(name, module)
    this.#directoryPath = directoryPath
    this.#runtime = runtime
  }

  /**
   * Get the OPFS file name that contains the data for the given SQLite file.
   *
   * @remarks
   *
   * This would be for one of the files in the pool managed by this VFS.
   * It's not the same as the SQLite file name. It's a randomly-generated
   * string that is not meaningful to the application.
   */
  getOpfsFileName = Effect.fn((zName: string) =>
    Effect.gen(this, function* () {
      const path = this.#getPath(zName)
      const accessHandle = this.#mapPathToAccessHandle.get(path)

      if (!accessHandle) {
        return yield* new OpfsError({
          cause: new Error('Cannot get OPFS file name for untracked path'),
          path,
        })
      }

      const name = this.#mapAccessHandleToName.get(accessHandle)
      if (!name) {
        return yield* new OpfsError({
          cause: new Error('Access handle not found in name mapping'),
          path,
        })
      }

      return name
    }),
  )

  /**
   * Reads the SQLite payload (without the OPFS header) for the given file.
   *
   * @privateRemarks
   *
   * Since the file's access handle is a FileSystemSyncAccessHandle — which
   * acquires an exclusive lock — we don't need to handle short reads as
   * the file cannot be modified by other threads.
   */
  readFilePayload = Effect.fn((zName: string) =>
    Effect.gen(this, function* () {
      const path = this.#getPath(zName)
      const accessHandle = this.#mapPathToAccessHandle.get(path)

      if (accessHandle === undefined) {
        return yield* new OpfsError({
          path,
          cause: new Error('Cannot read payload for untracked OPFS path'),
        })
      }

      const fileSize = yield* Opfs.Opfs.syncGetSize(accessHandle)
      if (fileSize <= HEADER_OFFSET_DATA) {
        return yield* new OpfsError({
          path,
          cause: new Error(
            `OPFS file too small to contain header and payload: size ${fileSize} < HEADER_OFFSET_DATA ${HEADER_OFFSET_DATA}`,
          ),
        })
      }

      const payloadSize = fileSize - HEADER_OFFSET_DATA
      const payload = new Uint8Array(payloadSize)
      const bytesRead = yield* Opfs.Opfs.syncRead(accessHandle, payload.buffer, { at: HEADER_OFFSET_DATA })
      if (bytesRead !== payloadSize) {
        return yield* new OpfsError({
          path,
          cause: new Error(`Failed to read full payload from OPFS file: read ${bytesRead}/${payloadSize}`),
        })
      }

      return payload.buffer
    }),
  )

  resetAccessHandle = Effect.fn((zName: string) =>
    Effect.gen(this, function* () {
      const path = this.#getPath(zName)
      const accessHandle = this.#mapPathToAccessHandle.get(path)

      if (!accessHandle) {
        return yield* new OpfsError({
          cause: new Error('Cannot reset untracked access handle'),
          path,
        })
      }

      yield* Opfs.Opfs.syncTruncate(accessHandle, HEADER_OFFSET_DATA)
    }),
  )

  jOpen(zName: string, fileId: number, flags: number, pOutFlags: DataView): number {
    return Effect.gen(this, function* () {
      // First try to open a path that already exists in the file system.
      const path = zName ? this.#getPath(zName) : Math.random().toString(36)
      let accessHandle = this.#mapPathToAccessHandle.get(path)
      if (!accessHandle && flags & VFS.SQLITE_OPEN_CREATE) {
        // File not found so try to create it.
        if (this.getSize() < this.getCapacity()) {
          // Choose an unassociated OPFS file from the pool.
          ;[accessHandle] = this.#availableAccessHandles.keys()
          yield* this.#setAssociatedPath(accessHandle!, path, flags)
        } else {
          // Out of unassociated files. This can be fixed by calling
          // addCapacity() from the application.
          return yield* Effect.fail(new Error('cannot create file'))
        }
      }
      if (!accessHandle) {
        return yield* Effect.fail(new Error('file not found'))
      }
      // Subsequent methods are only passed the fileId, so make sure we have
      // a way to get the file resources.
      const file = { path, flags, accessHandle }
      this.#mapIdToFile.set(fileId, file)

      pOutFlags.setInt32(0, flags, true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_CANTOPEN)),
      Runtime.runSync(this.#runtime),
    )
  }

  jClose(fileId: number): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)
      if (file) {
        yield* Opfs.Opfs.syncFlush(file.accessHandle)
        this.#mapIdToFile.delete(fileId)
        if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
          yield* this.#deletePath(file.path)
        }
      }
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_CLOSE)),
      Runtime.runSync(this.#runtime),
    )
  }

  jRead(fileId: number, pData: Uint8Array<ArrayBuffer>, iOffset: number): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)!
      const nBytes = yield* Opfs.Opfs.syncRead(file.accessHandle, pData.buffer, {
        at: HEADER_OFFSET_DATA + iOffset,
      })
      if (nBytes < pData.byteLength) {
        pData.fill(0, nBytes, pData.byteLength)
        return VFS.SQLITE_IOERR_SHORT_READ
      }
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_READ)),
      Runtime.runSync(this.#runtime),
    )
  }

  jWrite(fileId: number, pData: Uint8Array<ArrayBuffer>, iOffset: number): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)!
      const nBytes = yield* Opfs.Opfs.syncWrite(file.accessHandle, pData.subarray(), {
        at: HEADER_OFFSET_DATA + iOffset,
      })
      return nBytes === pData.byteLength ? VFS.SQLITE_OK : VFS.SQLITE_IOERR
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_WRITE)),
      Runtime.runSync(this.#runtime),
    )
  }

  jTruncate(fileId: number, iSize: number): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)!
      yield* Opfs.Opfs.syncTruncate(file.accessHandle, HEADER_OFFSET_DATA + iSize)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_TRUNCATE)),
      Runtime.runSync(this.#runtime),
    )
  }

  jSync(fileId: number, _flags: number): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)!
      yield* Opfs.Opfs.syncFlush(file.accessHandle)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_FSYNC)),
      Runtime.runSync(this.#runtime),
    )
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    return Effect.gen(this, function* () {
      const file = this.#mapIdToFile.get(fileId)!
      const fileSize = yield* Opfs.Opfs.syncGetSize(file.accessHandle)
      const size = fileSize - HEADER_OFFSET_DATA
      pSize64.setBigInt64(0, BigInt(size), true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_FSTAT)),
      Runtime.runSync(this.#runtime),
    )
  }

  jSectorSize(_fileId: number): number {
    return SECTOR_SIZE
  }

  jDeviceCharacteristics(_fileId: number): number {
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
  }

  jAccess(zName: string, _flags: number, pResOut: DataView): number {
    return Effect.gen(this, function* () {
      const path = this.#getPath(zName)
      pResOut.setInt32(0, this.#mapPathToAccessHandle.has(path) ? 1 : 0, true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_ACCESS)),
      Runtime.runSync(this.#runtime),
    )
  }

  jDelete(zName: string, _syncDir: number): number {
    return Effect.gen(this, function* () {
      const path = this.#getPath(zName)
      this.#deletePath(path).pipe(Runtime.runSync(this.#runtime))
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.catchAllCause(() => Effect.succeed(VFS.SQLITE_IOERR_DELETE)),
      Runtime.runSync(this.#runtime),
    )
  }

  close() {
    this.#releaseAccessHandles().pipe(Runtime.runPromise(this.#runtime))
  }

  async isReady() {
    return Effect.gen(this, function* () {
      if (this.#directoryHandle) return true

      this.#directoryHandle = yield* Opfs.getDirectoryHandleByPath(this.#directoryPath, { create: true })

      yield* this.#acquireAccessHandles()
      if (this.getCapacity() === 0) yield* this.addCapacity(DEFAULT_CAPACITY)

      return true
    }).pipe(Runtime.runPromise(this.#runtime))
  }

  /**
   * Returns the number of SQLite files in the file system.
   */
  getSize(): number {
    return this.#mapPathToAccessHandle.size
  }

  /**
   * Returns the maximum number of SQLite files the file system can hold.
   */
  getCapacity(): number {
    return this.#mapAccessHandleToName.size
  }

  /**
   * Get all currently tracked SQLite file paths.
   * This can be used by higher-level components for file management operations.
   *
   * @returns Array of currently active SQLite file paths
   */
  getTrackedFilePaths(): string[] {
    return Array.from(this.#mapPathToAccessHandle.keys())
  }

  /**
   * Increase the capacity of the file system by n.
   */
  addCapacity: (n: number) => Effect.Effect<void, OpfsError | WebError.WebError, Opfs.Opfs | Scope.Scope> = Effect.fn(
    (n: number) =>
      Effect.repeatN(
        Effect.gen(this, function* () {
          const name = Math.random().toString(36).replace('0.', '')
          const fileHandle = yield* Opfs.Opfs.getFileHandle(this.#directoryHandle!, name, { create: true })
          const syncFileHandle = yield* Opfs.Opfs.createSyncAccessHandle(fileHandle).pipe(
            Effect.retry(Schedule.exponentialBackoff10Sec),
          )

          this.#mapAccessHandleToName.set(syncFileHandle, name)
          yield* this.#setAssociatedPath(syncFileHandle, '', 0)
        }),
        n,
      ),
  )

  /**
   * Decrease the capacity of the file system by n. The capacity cannot be
   * decreased to fewer than the current number of SQLite files in the
   * file system.
   */
  removeCapacity = Effect.fn((n: number) =>
    Effect.gen(this, function* () {
      let nRemoved = 0
      yield* Effect.forEach(
        this.#availableAccessHandles,
        (accessHandle) =>
          Effect.gen(this, function* () {
            if (nRemoved === n || this.getSize() === this.getCapacity()) return nRemoved

            const name = this.#mapAccessHandleToName.get(accessHandle)!
            accessHandle.close()
            yield* Opfs.Opfs.removeEntry(this.#directoryHandle!, name)
            this.#mapAccessHandleToName.delete(accessHandle)
            this.#availableAccessHandles.delete(accessHandle)
            ++nRemoved
          }),
        { concurrency: 'unbounded', discard: true },
      )
      return nRemoved
    }),
  )

  #acquireAccessHandles = Effect.fn(() =>
    Effect.gen(this, function* () {
      const handlesStream = yield* Opfs.Opfs.values(this.#directoryHandle!)

      yield* handlesStream.pipe(
        Stream.filter((handle) => handle.kind === 'file'),
        Stream.mapEffect(
          (fileHandle) =>
            Effect.gen(function* () {
              return {
                fileHandleName: fileHandle.name,
                syncFileHandle: yield* Opfs.Opfs.createSyncAccessHandle(fileHandle),
              } as const
            }),
          { concurrency: 'unbounded' },
        ),
        Stream.runForEach(({ fileHandleName, syncFileHandle }) =>
          Effect.gen(this, function* () {
            // Store handle-to-name mapping
            this.#mapAccessHandleToName.set(syncFileHandle, fileHandleName)

            // Read associated path from file header
            const path = yield* this.#getAssociatedPath(syncFileHandle)

            // Categorize handle as associated or available
            if (path) {
              this.#mapPathToAccessHandle.set(path, syncFileHandle)
            } else {
              this.#availableAccessHandles.add(syncFileHandle)
            }
          }),
        ),
      )
    }),
  )

  #releaseAccessHandles = Effect.fn(() =>
    Effect.gen(this, function* () {
      yield* Effect.forEach(
        this.#mapAccessHandleToName.keys(),
        (accessHandle) => Effect.sync(() => accessHandle.close()),
        { concurrency: 'unbounded', discard: true },
      )
      this.#mapAccessHandleToName.clear()
      this.#mapPathToAccessHandle.clear()
      this.#availableAccessHandles.clear()
    }),
  )

  /**
   * Read and return the associated path from an OPFS file header.
   * Empty string is returned for an unassociated OPFS file.
   * @returns {string} path or empty string
   */
  #getAssociatedPath = Effect.fn((accessHandle: FileSystemSyncAccessHandle) =>
    Effect.gen(this, function* () {
      // Read the path and digest of the path from the file.
      const corpus = new Uint8Array(HEADER_CORPUS_SIZE)
      yield* Opfs.Opfs.syncRead(accessHandle, corpus.buffer, { at: 0 })

      // Delete files not expected to be present.
      const dataView = new DataView(corpus.buffer, corpus.byteOffset)
      const flags = dataView.getUint32(HEADER_OFFSET_FLAGS)
      if (corpus[0] && (flags & VFS.SQLITE_OPEN_DELETEONCLOSE || (flags & PERSISTENT_FILE_TYPES) === 0)) {
        yield* Effect.logWarning(`Remove file with unexpected flags ${flags.toString(16)}`)
        yield* this.#setAssociatedPath(accessHandle, '', 0)
        return ''
      }

      const fileDigest = new Uint32Array(HEADER_DIGEST_SIZE / 4)
      yield* Opfs.Opfs.syncRead(accessHandle, fileDigest.buffer, { at: HEADER_OFFSET_DIGEST })

      // Verify the digest.
      const computedDigest = this.#computeDigest(corpus)
      if (fileDigest.every((value, i) => value === computedDigest[i])) {
        // Good digest. Decode the null-terminated path string.
        const pathBytes = corpus.indexOf(0)
        if (pathBytes === 0) {
          // Ensure that unassociated files are empty. Unassociated files are
          // truncated in #setAssociatedPath after the header is written. If
          // an interruption occurs right before the truncation then garbage
          // may remain in the file.
          yield* Opfs.Opfs.syncTruncate(accessHandle, HEADER_OFFSET_DATA)
        }
        return new TextDecoder().decode(corpus.subarray(0, pathBytes))
      } else {
        // Bad digest. Repair this header.
        yield* Effect.logWarning('Disassociating file with bad digest.')
        yield* this.#setAssociatedPath(accessHandle, '', 0)
        return ''
      }
    }),
  )

  /**
   * Set the path on an OPFS file header.
   */
  #setAssociatedPath = Effect.fn((accessHandle: FileSystemSyncAccessHandle, path: string, flags: number) =>
    Effect.gen(this, function* () {
      // Convert the path string to UTF-8.
      const corpus = new Uint8Array(HEADER_CORPUS_SIZE)
      const encodedResult = new TextEncoder().encodeInto(path, corpus)

      if (encodedResult.written >= HEADER_MAX_PATH_SIZE) {
        return yield* new OpfsError({
          cause: new Error('Path too long'),
          path,
        })
      }

      // Add the creation flags.
      const dataView = new DataView(corpus.buffer, corpus.byteOffset)
      dataView.setUint32(HEADER_OFFSET_FLAGS, flags)

      // Write the OPFS file header, including the digest.
      const digest = this.#computeDigest(corpus)
      yield* Opfs.Opfs.syncWrite(accessHandle, corpus, { at: 0 })
      yield* Opfs.Opfs.syncWrite(accessHandle, digest, { at: HEADER_OFFSET_DIGEST })
      yield* Opfs.Opfs.syncFlush(accessHandle)

      if (path) {
        this.#mapPathToAccessHandle.set(path, accessHandle)
        this.#availableAccessHandles.delete(accessHandle)
      } else {
        // This OPFS file doesn't represent any SQLite file so it doesn't
        // need to keep any data.
        yield* Opfs.Opfs.syncTruncate(accessHandle, HEADER_OFFSET_DATA)
        this.#availableAccessHandles.add(accessHandle)
      }
    }),
  )

  /**
   * We need a synchronous digest function so can't use WebCrypto.
   * Adapted from https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
   * @returns {ArrayBuffer} 64-bit digest
   */
  #computeDigest(corpus: Uint8Array): Uint32Array {
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
   * Convert a bare filename, path, or URL to a UNIX-style path.
   */
  #getPath(nameOrURL: string | URL): string {
    const url = typeof nameOrURL === 'string' ? new URL(nameOrURL, 'file://localhost/') : nameOrURL
    return url.pathname
  }

  /**
   * Remove the association between a path and an OPFS file.
   * @param {string} path
   */
  #deletePath = Effect.fn((path: string) =>
    Effect.gen(this, function* () {
      const accessHandle = this.#mapPathToAccessHandle.get(path)
      if (accessHandle) {
        // Un-associate the SQLite path from the OPFS file.
        this.#mapPathToAccessHandle.delete(path)
        yield* this.#setAssociatedPath(accessHandle, '', 0)
      }
    }),
  )
}

export class OpfsError extends Schema.TaggedError<OpfsError>()('OpfsError', {
  cause: Schema.Defect,
  path: Schema.String,
}) {}
