import { Context, type Effect } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import type { VfsError } from './VfsError.ts'

/**
 * Options for opening a file.
 */
export interface OpenFileOptions {
  /** Create the file if it doesn't exist */
  readonly create: boolean
  /** Open as read-only */
  readonly readOnly: boolean
  /** Delete the file when closed */
  readonly deleteOnClose: boolean
  /** Raw SQLite flags for platform-specific handling */
  readonly flags: number
}

/**
 * Opaque handle representing an open file.
 */
export interface VfsFileHandle {
  readonly _tag: 'VfsFileHandle'
  /** Internal identifier used by the adapter */
  readonly id: number
  /** Path of the file */
  readonly path: string
}

/**
 * Result of a read operation.
 */
export interface ReadResult {
  /** Number of bytes actually read */
  readonly bytesRead: number
  /** True if fewer bytes were read than requested */
  readonly isShortRead: boolean
}

/**
 * Core VFS backend service shape.
 *
 * This interface defines the operations required by SQLite's VFS layer.
 * Platform-specific implementations provide this interface via layers.
 *
 * The adapter (VfsAdapter) manages the mapping between SQLite file IDs
 * and VfsFileHandle instances, so implementations don't need to worry
 * about SQLite's numeric file identifiers.
 */
export interface VfsBackendShape {
  /**
   * Open a file at the given path.
   *
   * @param path - File path to open
   * @param options - Open options (create, readOnly, deleteOnClose)
   * @returns Handle to the opened file
   */
  readonly openFile: (path: string, options: OpenFileOptions) => Effect.Effect<VfsFileHandle, VfsError>

  /**
   * Close a file and release its resources.
   *
   * @param handle - Handle to the file to close
   */
  readonly closeFile: (handle: VfsFileHandle) => Effect.Effect<void, VfsError>

  /**
   * Read data from a file at the specified offset.
   *
   * @param handle - Handle to the file
   * @param buffer - Buffer to read into
   * @param offset - Byte offset in the file to start reading from
   * @returns Result indicating bytes read and whether it was a short read
   */
  readonly read: (handle: VfsFileHandle, buffer: Uint8Array, offset: number) => Effect.Effect<ReadResult, VfsError>

  /**
   * Write data to a file at the specified offset.
   *
   * @param handle - Handle to the file
   * @param data - Data to write
   * @param offset - Byte offset in the file to start writing to
   */
  readonly write: (handle: VfsFileHandle, data: Uint8Array, offset: number) => Effect.Effect<void, VfsError>

  /**
   * Truncate a file to the specified size.
   *
   * @param handle - Handle to the file
   * @param size - New size in bytes
   */
  readonly truncate: (handle: VfsFileHandle, size: number) => Effect.Effect<void, VfsError>

  /**
   * Sync file data to persistent storage.
   *
   * @param handle - Handle to the file
   */
  readonly sync: (handle: VfsFileHandle) => Effect.Effect<void, VfsError>

  /**
   * Get the current size of a file.
   *
   * @param handle - Handle to the file
   * @returns File size in bytes
   */
  readonly getSize: (handle: VfsFileHandle) => Effect.Effect<number, VfsError>

  /**
   * Delete a file by path.
   *
   * @param path - Path of the file to delete
   */
  readonly deleteFile: (path: string) => Effect.Effect<void, VfsError>

  /**
   * Check if a file exists.
   *
   * @param path - Path to check
   * @returns True if the file exists
   */
  readonly exists: (path: string) => Effect.Effect<boolean, VfsError>

  /**
   * Platform-specific sector size used by SQLite.
   * Typically 4096 bytes.
   */
  readonly sectorSize: number

  /**
   * Platform-specific device characteristics flags.
   * Used by SQLite to optimize I/O operations.
   */
  readonly deviceCharacteristics: number
}

/**
 * Context tag for the VFS backend service.
 *
 * Platform-specific implementations provide this service:
 * - OpfsVfs for browser OPFS
 * - NodeVfs for Node.js
 * - CfVfs for Cloudflare
 */
export class VfsBackend extends Context.Tag('@livestore/sqlite-wasm/VfsBackend')<VfsBackend, VfsBackendShape>() {}

/**
 * Create a VfsFileHandle with the given id and path.
 */
export const makeFileHandle = (id: number, path: string): VfsFileHandle => ({
  _tag: 'VfsFileHandle',
  id,
  path,
})

/**
 * Default sector size for VFS implementations.
 */
export const DEFAULT_SECTOR_SIZE = 4096

/**
 * Default device characteristics for VFS implementations.
 */
export const DEFAULT_DEVICE_CHARACTERISTICS = VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
