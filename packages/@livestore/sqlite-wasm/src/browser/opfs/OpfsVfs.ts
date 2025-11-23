/**
 * OPFS VFS backend layer.
 *
 * Provides a `VfsBackend` implementation using OPFS access handle pool.
 *
 * @module
 */

import { Context, Effect, Layer, type Opfs, type Scope, type WebError } from '@livestore/utils/effect'

import {
  DEFAULT_DEVICE_CHARACTERISTICS,
  DEFAULT_SECTOR_SIZE,
  makeFileHandle,
  type OpenFileOptions,
  type ReadResult,
  VfsBackend,
  type VfsFileHandle,
} from '../../vfs/VfsBackend.ts'
import { VfsError } from '../../vfs/VfsError.ts'
import { HEADER_OFFSET_DATA, makeOpfsPoolLayer, OpfsPool, type OpfsPoolConfig } from './OpfsPool.ts'

// Re-export OpfsPool and config for convenience
export { HEADER_OFFSET_DATA, makeOpfsPoolLayer, OpfsPool, type OpfsPoolConfig, type OpfsPoolShape } from './OpfsPool.ts'

/**
 * Internal state for an open file.
 */
interface OpfsFileState {
  /** Path of the file */
  path: string
  /** SQLite open flags */
  flags: number
  /** OPFS access handle */
  accessHandle: FileSystemSyncAccessHandle
}

/**
 * Create a VfsBackend layer that uses OPFS via OpfsPool.
 *
 * This layer depends on OpfsPool being available in the context.
 *
 * @example
 * ```ts
 * import { makeOpfsPoolLayer, makeOpfsVfsBackendLayer } from '@livestore/sqlite-wasm/browser/opfs'
 *
 * const config = { directoryPath: '/sqlite' }
 * const layer = makeOpfsVfsBackendLayer().pipe(
 *   Layer.provide(makeOpfsPoolLayer(config))
 * )
 * ```
 */
export const makeOpfsVfsBackendLayer = (): Layer.Layer<VfsBackend, never, OpfsPool> =>
  Layer.effect(
    VfsBackend,
    Effect.gen(function* () {
      const pool = yield* OpfsPool

      // State: map of internal handle ID to file state
      const fileStates = new Map<number, OpfsFileState>()
      let nextId = 0

      const openFile = (filePath: string, options: OpenFileOptions): Effect.Effect<VfsFileHandle, VfsError> =>
        Effect.gen(function* () {
          const accessHandle = yield* pool.acquireHandle(filePath, options.flags, options.create)

          const id = nextId++
          const handle = makeFileHandle(id, filePath)

          fileStates.set(id, {
            path: filePath,
            flags: options.flags,
            accessHandle,
          })

          return handle
        })

      const closeFile = (handle: VfsFileHandle): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) return

          const deleteOnClose = Boolean(state.flags & 0x8) // SQLITE_OPEN_DELETEONCLOSE
          yield* pool.releaseHandle(state.path, deleteOnClose)

          fileStates.delete(handle.id)
        })

      const read = (handle: VfsFileHandle, buffer: Uint8Array, offset: number): Effect.Effect<ReadResult, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Read',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          const bytesRead = yield* Effect.try({
            try: () => state.accessHandle.read(buffer.subarray(), { at: HEADER_OFFSET_DATA + offset }),
            catch: (cause) =>
              new VfsError({
                code: 'Read',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to read',
                cause,
              }),
          })

          // Zero-fill the remaining buffer if short read
          if (bytesRead < buffer.length) {
            buffer.fill(0, bytesRead, buffer.length)
          }

          return {
            bytesRead,
            isShortRead: bytesRead < buffer.length,
          }
        })

      const write = (handle: VfsFileHandle, data: Uint8Array, offset: number): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Write',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          const bytesWritten = yield* Effect.try({
            try: () => state.accessHandle.write(data.subarray(), { at: HEADER_OFFSET_DATA + offset }),
            catch: (cause) =>
              new VfsError({
                code: 'Write',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to write',
                cause,
              }),
          })

          if (bytesWritten !== data.length) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Write',
                path: handle.path,
                message: `Wrote ${bytesWritten} bytes, expected ${data.length}`,
              }),
            )
          }
        })

      const truncate = (handle: VfsFileHandle, size: number): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Truncate',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          yield* Effect.try({
            try: () => state.accessHandle.truncate(HEADER_OFFSET_DATA + size),
            catch: (cause) =>
              new VfsError({
                code: 'Truncate',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to truncate',
                cause,
              }),
          })
        })

      const sync = (handle: VfsFileHandle): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Sync',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          yield* Effect.try({
            try: () => state.accessHandle.flush(),
            catch: (cause) =>
              new VfsError({
                code: 'Sync',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to sync',
                cause,
              }),
          })
        })

      const getSize = (handle: VfsFileHandle): Effect.Effect<number, VfsError> =>
        Effect.gen(function* () {
          const state = fileStates.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'FileSize',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          const opfsSize = yield* Effect.try({
            try: () => state.accessHandle.getSize(),
            catch: (cause) =>
              new VfsError({
                code: 'FileSize',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to get size',
                cause,
              }),
          })

          return opfsSize - HEADER_OFFSET_DATA
        })

      const deleteFile = (filePath: string): Effect.Effect<void, VfsError> =>
        pool.releaseHandle(filePath, true)

      const exists = (filePath: string): Effect.Effect<boolean, VfsError> =>
        Effect.sync(() => pool.pathExists(filePath))

      return {
        openFile,
        closeFile,
        read,
        write,
        truncate,
        sync,
        getSize,
        deleteFile,
        exists,
        sectorSize: DEFAULT_SECTOR_SIZE,
        deviceCharacteristics: DEFAULT_DEVICE_CHARACTERISTICS,
      }
    }),
  )

/**
 * Create a combined layer that provides both VfsBackend and OpfsPool.
 *
 * This is a convenience function that combines makeOpfsPoolLayer and makeOpfsVfsBackendLayer.
 *
 * @example
 * ```ts
 * import { makeOpfsLayer } from '@livestore/sqlite-wasm/browser/opfs'
 *
 * const layer = makeOpfsLayer({ directoryPath: '/sqlite' })
 * // Provides: VfsBackend | OpfsPool
 * ```
 */
export const makeOpfsLayer = (
  config: OpfsPoolConfig,
): Layer.Layer<VfsBackend | OpfsPool, WebError.WebError | Opfs.OpfsError | VfsError, Opfs.Opfs | Scope.Scope> => {
  const poolLayer = makeOpfsPoolLayer(config)
  const vfsBackendLayer = makeOpfsVfsBackendLayer()

  // Provide OpfsPool to VfsBackend layer, then merge with poolLayer to expose both services
  const vfsBackendLayerWithPool = vfsBackendLayer.pipe(Layer.provide(poolLayer))
  return Layer.merge(poolLayer, vfsBackendLayerWithPool)
}
