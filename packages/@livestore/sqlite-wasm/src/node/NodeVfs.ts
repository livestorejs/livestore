/// <reference types="node" />

/**
 * Node.js VFS backend layer.
 *
 * Provides a `VfsBackend` implementation using Node.js synchronous fs operations.
 *
 * @module
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Context, Effect, Layer, Ref } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import {
  DEFAULT_DEVICE_CHARACTERISTICS,
  DEFAULT_SECTOR_SIZE,
  makeFileHandle,
  type OpenFileOptions,
  type ReadResult,
  VfsBackend,
  type VfsFileHandle,
} from '../vfs/VfsBackend.ts'
import { VfsError } from '../vfs/VfsError.ts'

/**
 * Internal state for an open file.
 */
interface NodeFileState {
  /** Node.js file descriptor */
  fd: number
  /** Original path */
  path: string
  /** SQLite open flags */
  flags: number
}

/**
 * Configuration for the Node.js VFS.
 */
export interface NodeVfsConfig {
  /** Directory where database files are stored */
  readonly directory: string
}

/**
 * NodeVfs service shape.
 *
 * Provides Node.js-specific utilities beyond core VFS operations.
 */
export interface NodeVfsShape {
  /**
   * Get the configured directory path.
   */
  readonly getDirectory: () => string

  /**
   * Delete a database file by name.
   * Resolves the path relative to the configured directory.
   */
  readonly deleteDb: (fileName: string) => Effect.Effect<void, VfsError>

  /**
   * Check if a database file exists by name.
   * Resolves the path relative to the configured directory.
   */
  readonly dbExists: (fileName: string) => Effect.Effect<boolean>
}

/**
 * NodeVfs service tag.
 *
 * Provides Node.js-specific utilities. For VFS operations, use VfsBackend.
 */
export class NodeVfs extends Context.Tag('@livestore/sqlite-wasm/NodeVfs')<NodeVfs, NodeVfsShape>() {}

/**
 * Create a VfsBackend layer that uses Node.js fs.
 *
 * @example
 * ```ts
 * import { makeNodeVfsBackendLayer } from '@livestore/sqlite-wasm/node'
 *
 * const layer = makeNodeVfsBackendLayer({ directory: './data' })
 * ```
 */
export const makeNodeVfsBackendLayer = (config: NodeVfsConfig): Layer.Layer<VfsBackend> =>
  Layer.effect(
    VfsBackend,
    Effect.gen(function* () {
      // State: map of internal handle ID to file state
      const fileStates = yield* Ref.make(new Map<number, NodeFileState>())
      let nextId = 0

      const resolvePath = (filePath: string) => path.resolve(config.directory, filePath)

      const openFile = (filePath: string, options: OpenFileOptions): Effect.Effect<VfsFileHandle, VfsError> =>
        Effect.gen(function* () {
          const fullPath = resolvePath(filePath)

          // Determine Node.js file flags
          let fsFlags = 'r'
          if (options.create && !options.readOnly) {
            const exists = fs.existsSync(fullPath)
            fsFlags = exists ? 'r+' : 'w+'
          } else if (!options.readOnly) {
            fsFlags = 'r+'
          }

          const fd = yield* Effect.try({
            try: () => fs.openSync(fullPath, fsFlags),
            catch: (cause) =>
              new VfsError({
                code: 'CannotOpen',
                path: filePath,
                message: cause instanceof Error ? cause.message : 'Failed to open file',
                cause,
              }),
          })

          const id = nextId++
          const handle = makeFileHandle(id, filePath)

          yield* Ref.update(fileStates, (map) => {
            const newMap = new Map(map)
            newMap.set(id, { fd, path: filePath, flags: options.flags })
            return newMap
          })

          return handle
        })

      const closeFile = (handle: VfsFileHandle): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const states = yield* Ref.get(fileStates)
          const state = states.get(handle.id)
          if (!state) return

          yield* Effect.try({
            try: () => fs.closeSync(state.fd),
            catch: (cause) =>
              new VfsError({
                code: 'Close',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to close file',
                cause,
              }),
          })

          // Handle DELETEONCLOSE flag - ignore errors
          if (state.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
            yield* Effect.sync(() => fs.unlinkSync(resolvePath(state.path))).pipe(Effect.ignore)
          }

          yield* Ref.update(fileStates, (map) => {
            const newMap = new Map(map)
            newMap.delete(handle.id)
            return newMap
          })
        })

      const read = (handle: VfsFileHandle, buffer: Uint8Array, offset: number): Effect.Effect<ReadResult, VfsError> =>
        Effect.gen(function* () {
          const states = yield* Ref.get(fileStates)
          const state = states.get(handle.id)
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
            try: () => fs.readSync(state.fd, buffer.subarray(), { position: offset }),
            catch: (cause) =>
              new VfsError({
                code: 'Read',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to read file',
                cause,
              }),
          })

          return {
            bytesRead,
            isShortRead: bytesRead < buffer.length,
          }
        })

      const write = (handle: VfsFileHandle, data: Uint8Array, offset: number): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const states = yield* Ref.get(fileStates)
          const state = states.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'Write',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          yield* Effect.try({
            try: () => fs.writeSync(state.fd, Buffer.from(data.subarray()), 0, data.length, offset),
            catch: (cause) =>
              new VfsError({
                code: 'Write',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to write file',
                cause,
              }),
          })
        })

      const truncate = (handle: VfsFileHandle, size: number): Effect.Effect<void, VfsError> =>
        Effect.gen(function* () {
          const states = yield* Ref.get(fileStates)
          const state = states.get(handle.id)
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
            try: () => fs.ftruncateSync(state.fd, size),
            catch: (cause) =>
              new VfsError({
                code: 'Truncate',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to truncate file',
                cause,
              }),
          })
        })

      const sync = (_handle: VfsFileHandle): Effect.Effect<void, VfsError> =>
        // Node.js VFS currently skips fsync for performance (matching NodeFS.ts behavior)
        Effect.void

      const getSize = (handle: VfsFileHandle): Effect.Effect<number, VfsError> =>
        Effect.gen(function* () {
          const states = yield* Ref.get(fileStates)
          const state = states.get(handle.id)
          if (!state) {
            return yield* Effect.fail(
              new VfsError({
                code: 'FileSize',
                path: handle.path,
                message: 'File not open',
              }),
            )
          }

          const stats = yield* Effect.try({
            try: () => fs.fstatSync(state.fd),
            catch: (cause) =>
              new VfsError({
                code: 'FileSize',
                path: handle.path,
                message: cause instanceof Error ? cause.message : 'Failed to get file size',
                cause,
              }),
          })

          return stats.size
        })

      const deleteFile = (filePath: string): Effect.Effect<void, VfsError> =>
        Effect.try({
          try: () => fs.unlinkSync(resolvePath(filePath)),
          catch: (cause) =>
            new VfsError({
              code: 'Delete',
              path: filePath,
              message: cause instanceof Error ? cause.message : 'Failed to delete file',
              cause,
            }),
        }).pipe(Effect.asVoid)

      const exists = (filePath: string): Effect.Effect<boolean, VfsError> =>
        Effect.sync(() => fs.existsSync(resolvePath(filePath)))

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
 * Create a NodeVfs layer with the given configuration.
 *
 * This provides only the Node.js-specific utilities.
 * Use makeNodeVfsBackendLayer for VFS operations.
 */
export const makeNodeVfsUtilsLayer = (config: NodeVfsConfig): Layer.Layer<NodeVfs> =>
  Layer.succeed(NodeVfs, {
    getDirectory: () => config.directory,
    deleteDb: (fileName: string) =>
      Effect.try({
        try: () => fs.unlinkSync(path.resolve(config.directory, fileName)),
        catch: (cause) =>
          new VfsError({
            code: 'Delete',
            path: fileName,
            message: cause instanceof Error ? cause.message : 'Failed to delete database',
            cause,
          }),
      }).pipe(Effect.asVoid),
    dbExists: (fileName: string) => Effect.sync(() => fs.existsSync(path.resolve(config.directory, fileName))),
  })

/**
 * Create a combined layer that provides both VfsBackend and NodeVfs.
 *
 * This is a convenience function that combines makeNodeVfsBackendLayer and makeNodeVfsUtilsLayer.
 *
 * @example
 * ```ts
 * import { makeNodeVfsLayer } from '@livestore/sqlite-wasm/node'
 *
 * const layer = makeNodeVfsLayer({ directory: './data' })
 * // Provides: VfsBackend | NodeVfs
 * ```
 */
export const makeNodeVfsLayer = (config: NodeVfsConfig): Layer.Layer<VfsBackend | NodeVfs> => {
  const vfsBackendLayer = makeNodeVfsBackendLayer(config)
  const nodeVfsLayer = makeNodeVfsUtilsLayer(config)
  return Layer.merge(vfsBackendLayer, nodeVfsLayer)
}

/**
 * @deprecated Use makeNodeVfsLayer instead
 */
export const makeNodeVfsLayerWithBackend = makeNodeVfsLayer
