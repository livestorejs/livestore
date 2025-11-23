/**
 * VfsAdapter bridges the Effect-based VfsBackend service with SQLite's synchronous VFS interface.
 *
 * This class extends VFS.Base directly (replacing FacadeVFS) and handles:
 * - Pointer-to-JavaScript type translation (x* methods to typed values)
 * - Runtime.runSync execution of Effect operations
 * - Error mapping to SQLite result codes
 *
 * @module
 */

// @ts-nocheck - VFS.Base types don't match actual JS implementation
import { Effect, Runtime, type Scope } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import { type OpenFileOptions, VfsBackend, type VfsFileHandle } from './VfsBackend.ts'
import { VfsError } from './VfsError.ts'

const DEFAULT_SECTOR_SIZE = 4096

/**
 * Emscripten "legalizes" 64-bit integer arguments by passing them as
 * two 32-bit signed integers.
 */
const delegalize = (lo32: number, hi32: number): number => hi32 * 0x1_00_00_00_00 + lo32 + (lo32 < 0 ? 2 ** 32 : 0)

// Emscripten module interface (subset of what we need)
interface EmscriptenModule {
  HEAPU8: Uint8Array
  UTF8ToString: (ptr: number) => string
}

/**
 * Generic VFS adapter that bridges the Effect-based VfsBackend service
 * with SQLite's synchronous VFS interface.
 *
 * @remarks
 * This class extends VFS.Base and uses Runtime.runSync to execute
 * Effect operations synchronously as required by wa-sqlite's synchronous build.
 */
export class VfsAdapter extends VFS.Base {
  // Declare _module from parent class (JavaScript)
  declare _module: EmscriptenModule

  readonly #runtime: Runtime.Runtime<VfsBackend | Scope.Scope>
  readonly #handleMap = new Map<number, VfsFileHandle>()

  // Debug logging (disabled by default)
  log: ((...args: unknown[]) => void) | null = null

  /**
   * Create a VfsAdapter with the given runtime.
   *
   * @param name - Name for the VFS
   * @param module - WebAssembly module from wa-sqlite
   * @param runtime - Effect runtime with VfsBackend service
   */
  constructor(name: string, module: EmscriptenModule, runtime: Runtime.Runtime<VfsBackend | Scope.Scope>) {
    // @ts-expect-error VFS.Base constructor takes (name, module) but types don't reflect this
    super(name, module)
    this.#runtime = runtime
  }

  /**
   * Create a VfsAdapter as an Effect.
   * Use this when constructing from within an Effect context.
   */
  static create = Effect.fn(function* (name: string, module: EmscriptenModule) {
    const runtime = yield* Effect.runtime<VfsBackend | Scope.Scope>()
    return new VfsAdapter(name, module, runtime)
  })

  // ============================================================================
  // VFS Methods (operate on paths)
  // ============================================================================

  /**
   * Open a file.
   * @override
   */
  override xOpen(_pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number): number {
    const filename = this.#decodeFilename(zName, flags)
    const pOutFlagsView = this.#makeTypedDataView('Int32', pOutFlags)

    this.log?.('xOpen', filename, pFile, `0x${flags.toString(16)}`)

    return Effect.gen(this, function* () {
      const backend = yield* VfsBackend
      const path = filename ?? Math.random().toString(36)
      const options: OpenFileOptions = {
        create: !!(flags & VFS.SQLITE_OPEN_CREATE),
        readOnly: !(flags & VFS.SQLITE_OPEN_READWRITE),
        deleteOnClose: !!(flags & VFS.SQLITE_OPEN_DELETEONCLOSE),
        flags,
      }

      const handle = yield* backend.openFile(path, options)
      this.#handleMap.set(pFile, handle)
      pOutFlagsView.setInt32(0, flags, true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_CANTOPEN)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Delete a file.
   * @override
   */
  override xDelete(_pVfs: number, zName: number, syncDir: number): number {
    const filename = this._module.UTF8ToString(zName)

    this.log?.('xDelete', filename, syncDir)

    return Effect.gen(this, function* () {
      const backend = yield* VfsBackend
      yield* backend.deleteFile(filename)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_DELETE)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Check if a file exists.
   * @override
   */
  override xAccess(_pVfs: number, zName: number, flags: number, pResOut: number): number {
    const filename = this._module.UTF8ToString(zName)
    const pResOutView = this.#makeTypedDataView('Int32', pResOut)

    this.log?.('xAccess', filename, flags)

    return Effect.gen(this, function* () {
      const backend = yield* VfsBackend
      const exists = yield* backend.exists(filename)
      pResOutView.setInt32(0, exists ? 1 : 0, true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_ACCESS)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Get the full pathname for a file.
   * @override
   */
  override xFullPathname(_pVfs: number, zName: number, nOut: number, zOut: number): number {
    const filename = this._module.UTF8ToString(zName)
    const zOutArray = this._module.HEAPU8.subarray(zOut, zOut + nOut)

    this.log?.('xFullPathname', filename, nOut)

    // Copy the filename to the output buffer
    const { read, written } = new TextEncoder().encodeInto(filename, zOutArray)
    if (read < filename.length) return VFS.SQLITE_IOERR
    if (written >= zOutArray.length) return VFS.SQLITE_IOERR
    zOutArray[written] = 0
    return VFS.SQLITE_OK
  }

  /**
   * Get the last error message.
   * @override
   */
  override xGetLastError(_pVfs: number, _nBuf: number, _zBuf: number): number {
    return VFS.SQLITE_OK
  }

  // ============================================================================
  // File Methods (operate on file handles)
  // ============================================================================

  /**
   * Close a file.
   * @override
   */
  override xClose(pFile: number): number {
    this.log?.('xClose', pFile)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) return VFS.SQLITE_OK

      const backend = yield* VfsBackend
      this.#handleMap.delete(pFile)
      yield* backend.closeFile(handle)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_CLOSE)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Read from a file.
   * @override
   */
  override xRead(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number {
    const pDataArray = this.#makeDataArray(pData, iAmt)
    const iOffset = delegalize(iOffsetLo, iOffsetHi)

    this.log?.('xRead', pFile, iAmt, iOffset)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) {
        return yield* Effect.fail(new VfsError({ code: 'Read', path: 'unknown', message: 'File not open' }))
      }

      const backend = yield* VfsBackend
      const result = yield* backend.read(handle, pDataArray, iOffset)
      if (result.isShortRead) {
        pDataArray.fill(0, result.bytesRead)
        return VFS.SQLITE_IOERR_SHORT_READ
      }
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_READ)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Write to a file.
   * @override
   */
  override xWrite(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number {
    const pDataArray = this.#makeDataArray(pData, iAmt)
    const iOffset = delegalize(iOffsetLo, iOffsetHi)

    this.log?.('xWrite', pFile, pDataArray, iOffset)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) {
        return yield* Effect.fail(new VfsError({ code: 'Write', path: 'unknown', message: 'File not open' }))
      }

      const backend = yield* VfsBackend
      yield* backend.write(handle, pDataArray, iOffset)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_WRITE)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Truncate a file.
   * @override
   */
  override xTruncate(pFile: number, sizeLo: number, sizeHi: number): number {
    const size = delegalize(sizeLo, sizeHi)

    this.log?.('xTruncate', pFile, size)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) {
        return yield* Effect.fail(new VfsError({ code: 'Truncate', path: 'unknown', message: 'File not open' }))
      }

      const backend = yield* VfsBackend
      yield* backend.truncate(handle, size)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_TRUNCATE)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Sync a file to persistent storage.
   * @override
   */
  override xSync(pFile: number, flags: number): number {
    this.log?.('xSync', pFile, flags)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) return VFS.SQLITE_OK

      const backend = yield* VfsBackend
      yield* backend.sync(handle)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_FSYNC)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Get the size of a file.
   * @override
   */
  override xFileSize(pFile: number, pSize: number): number {
    const pSizeView = this.#makeTypedDataView('BigInt64', pSize)

    this.log?.('xFileSize', pFile)

    return Effect.gen(this, function* () {
      const handle = this.#handleMap.get(pFile)
      if (!handle) {
        return yield* Effect.fail(new VfsError({ code: 'FileSize', path: 'unknown', message: 'File not open' }))
      }

      const backend = yield* VfsBackend
      const size = yield* backend.getSize(handle)
      pSizeView.setBigInt64(0, BigInt(size), true)
      return VFS.SQLITE_OK
    }).pipe(
      Effect.tapErrorCause(Effect.logWarning),
      Effect.catchAll((error: VfsError) => Effect.succeed(error.sqliteCode)),
      Effect.catchAllDefect(() => Effect.succeed(VFS.SQLITE_IOERR_FSTAT)),
      Runtime.runSync(this.#runtime),
    )
  }

  /**
   * Lock a file (no-op for most implementations).
   * @override
   */
  override xLock(pFile: number, lockType: number): number {
    this.log?.('xLock', pFile, lockType)
    return VFS.SQLITE_OK
  }

  /**
   * Unlock a file (no-op for most implementations).
   * @override
   */
  override xUnlock(pFile: number, lockType: number): number {
    this.log?.('xUnlock', pFile, lockType)
    return VFS.SQLITE_OK
  }

  /**
   * Check if a file has a reserved lock.
   * @override
   */
  override xCheckReservedLock(pFile: number, pResOut: number): number {
    const pResOutView = this.#makeTypedDataView('Int32', pResOut)
    this.log?.('xCheckReservedLock', pFile)
    pResOutView.setInt32(0, 0, true)
    return VFS.SQLITE_OK
  }

  /**
   * File control operations (mostly no-op).
   * @override
   */
  override xFileControl(pFile: number, op: number, _pArg: number): number {
    this.log?.('xFileControl', pFile, op)
    return VFS.SQLITE_NOTFOUND
  }

  /**
   * Get the sector size for a file.
   * @override
   */
  override xSectorSize(_pFile: number): number {
    this.log?.('xSectorSize', _pFile)
    return DEFAULT_SECTOR_SIZE
  }

  /**
   * Get device characteristics for a file.
   * @override
   */
  override xDeviceCharacteristics(_pFile: number): number {
    this.log?.('xDeviceCharacteristics', _pFile)
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
  }

  // ============================================================================
  // SQLiteVFS interface methods (inherited from VFS.Base but explicitly typed)
  // ============================================================================

  /**
   * Close the VFS (no-op for this implementation).
   */
  close(): void {
    // No resources to clean up at VFS level
  }

  /**
   * Check if VFS is ready.
   */
  isReady(): boolean {
    return true
  }

  // ============================================================================
  // Helper Methods (from FacadeVFS)
  // ============================================================================

  /**
   * Wrapped DataView for pointer arguments.
   * Pointers to a single value are passed using DataView. A Proxy
   * wrapper prevents use of incorrect type or endianness.
   */
  #makeTypedDataView(type: 'Int32' | 'BigInt64', byteOffset: number): DataView {
    const byteLength = type === 'Int32' ? 4 : 8
    const getter = `get${type}` as const
    const setter = `set${type}` as const
    const makeDataView = () =>
      new DataView(this._module.HEAPU8.buffer, this._module.HEAPU8.byteOffset + byteOffset, byteLength)
    let dataView = makeDataView()
    return new Proxy(dataView, {
      get(_, prop) {
        if (dataView.buffer.byteLength === 0) {
          // WebAssembly memory resize detached the buffer
          dataView = makeDataView()
        }
        if (prop === getter) {
          return (byteOffset: number, littleEndian: boolean) => {
            if (!littleEndian) throw new Error('must be little endian')
            return dataView[prop](byteOffset, littleEndian)
          }
        }
        if (prop === setter) {
          return (byteOffset: number, value: number | bigint, littleEndian: boolean) => {
            if (!littleEndian) throw new Error('must be little endian')
            return dataView[prop](byteOffset, value as never, littleEndian)
          }
        }
        if (typeof prop === 'string' && /^(get)|(set)/.test(prop)) {
          throw new Error('invalid type')
        }
        const result = (dataView as unknown as Record<string | symbol, unknown>)[prop]
        return typeof result === 'function' ? result.bind(dataView) : result
      },
    })
  }

  /**
   * Create a Uint8Array backed by WebAssembly memory.
   * Uses a Proxy to handle memory resize.
   */
  #makeDataArray(byteOffset: number, byteLength: number): Uint8Array {
    let target = this._module.HEAPU8.subarray(byteOffset, byteOffset + byteLength)
    return new Proxy(target, {
      get: (_, prop) => {
        if (target.buffer.byteLength === 0) {
          // WebAssembly memory resize detached the buffer
          target = this._module.HEAPU8.subarray(byteOffset, byteOffset + byteLength)
        }
        const result = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof result === 'function' ? result.bind(target) : result
      },
    }) as Uint8Array
  }

  /**
   * Decode a filename from WebAssembly memory.
   * Handles URI filenames with query parameters.
   */
  #decodeFilename(zName: number, flags: number): string | null {
    if (flags & VFS.SQLITE_OPEN_URI) {
      // The first null-terminated string is the URI path. Subsequent
      // strings are query parameter keys and values.
      // https://www.sqlite.org/c3ref/open.html#urifilenamesinsqlite3open
      let pName = zName
      let state: number | null = 1
      const charCodes: number[] = []
      while (state) {
        const charCode = this._module.HEAPU8[pName++]
        if (charCode) {
          charCodes.push(charCode)
        } else {
          if (!this._module.HEAPU8[pName]) state = null
          switch (state) {
            case 1: {
              // path
              charCodes.push('?'.charCodeAt(0))
              state = 2
              break
            }
            case 2: {
              // key
              charCodes.push('='.charCodeAt(0))
              state = 3
              break
            }
            case 3: {
              // value
              charCodes.push('&'.charCodeAt(0))
              state = 2
              break
            }
          }
        }
      }
      return new TextDecoder().decode(new Uint8Array(charCodes))
    }
    return zName ? this._module.UTF8ToString(zName) : null
  }
}
