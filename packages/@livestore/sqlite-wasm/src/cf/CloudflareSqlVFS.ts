import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { FacadeVFS } from '../FacadeVFS.ts'
import { BlockManager } from './BlockManager.ts'
import type * as Cf from './cf-types.ts'

const SECTOR_SIZE = 4096

// Block size for SQL-based storage (same as CloudflareWorkerVFS for consistency)
const BLOCK_SIZE = 64 * 1024 // 64 KiB

// Maximum number of open files
const DEFAULT_MAX_FILES = 100

// These file types are expected to persist in the file system
const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_SUPER_JOURNAL | VFS.SQLITE_OPEN_WAL

interface FileMetadata {
  path: string
  size: number
  flags: number
  created: number
  modified: number
}

interface FileHandle {
  path: string
  flags: number
  metadata: FileMetadata
}

export interface SqlVfsOptions {
  maxFiles?: number
  blockSize?: number
}

/**
 * VFS implementation using Cloudflare Durable Object SQL storage as the backend.
 * This provides a synchronous VFS interface by leveraging SQL's synchronous API.
 *
 * Storage Strategy:
 * - Files are stored as blocks in SQL tables for efficient I/O
 * - File metadata stored in vfs_files table
 * - File data stored as fixed-size blocks in vfs_blocks table
 * - Synchronous operations via SQL's synchronous API
 *
 * Key advantages over async VFS:
 * - No async/await complexity
 * - Native SQL ACID properties
 * - Efficient range queries for file operations
 * - Built-in consistency and durability
 */
export class CloudflareSqlVFS extends FacadeVFS {
  log = null

  #sql: Cf.SqlStorage
  #initialized = false
  #blockManager: BlockManager

  // File management
  #openFiles = new Map<number, FileHandle>()
  #maxFiles: number

  static async create(name: string, sql: Cf.SqlStorage, module: any, options: SqlVfsOptions = {}) {
    const vfs = new CloudflareSqlVFS(name, sql, module, options)
    await vfs.isReady()
    return vfs
  }

  constructor(name: string, sql: Cf.SqlStorage, module: any, options: SqlVfsOptions = {}) {
    super(name, module)
    this.#sql = sql
    this.#maxFiles = options.maxFiles || DEFAULT_MAX_FILES
    this.#blockManager = new BlockManager(options.blockSize || BLOCK_SIZE)
  }

  /**
   * Initialize the VFS by setting up SQL schema
   */
  async isReady(): Promise<boolean> {
    if (this.#initialized) {
      return true
    }

    try {
      // Initialize SQL schema
      this.#initializeSchema()

      // Clean up non-persistent files from previous sessions
      this.#cleanupNonPersistentFiles()

      this.#initialized = true
      return true
    } catch (error) {
      console.error('CloudflareSqlVFS initialization failed:', error)
      return false
    }
  }

  /**
   * Initialize the SQL schema for the VFS
   */
  #initializeSchema(): void {
    // Execute each statement individually to avoid parsing issues
    const statements = [
      `CREATE TABLE IF NOT EXISTS vfs_files (
        file_path TEXT PRIMARY KEY,
        file_size INTEGER NOT NULL DEFAULT 0,
        flags INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        modified_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,

      `CREATE TABLE IF NOT EXISTS vfs_blocks (
        file_path TEXT NOT NULL,
        block_id INTEGER NOT NULL,
        block_data BLOB NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (file_path, block_id),
        FOREIGN KEY (file_path) REFERENCES vfs_files(file_path) ON DELETE CASCADE
      )`,

      `CREATE INDEX IF NOT EXISTS idx_vfs_blocks_range ON vfs_blocks(file_path, block_id)`,

      `CREATE INDEX IF NOT EXISTS idx_vfs_files_modified ON vfs_files(modified_at)`,

      `CREATE TRIGGER IF NOT EXISTS trg_vfs_files_update_modified 
        AFTER UPDATE OF file_size ON vfs_files
        BEGIN
          UPDATE vfs_files SET modified_at = unixepoch() WHERE file_path = NEW.file_path;
        END`,
    ]

    for (const statement of statements) {
      try {
        this.#sql.exec(statement)
      } catch (error) {
        console.error('Failed to execute schema statement:', statement)
        throw error
      }
    }
  }

  /**
   * Clean up non-persistent files from previous sessions
   */
  #cleanupNonPersistentFiles(): void {
    try {
      const cursor = this.#sql.exec<{ file_path: string; flags: number }>('SELECT file_path, flags FROM vfs_files')

      const filesToDelete: string[] = []

      for (const row of cursor) {
        // Check if file should be persistent
        if (!(row.flags & PERSISTENT_FILE_TYPES)) {
          filesToDelete.push(row.file_path)
        }
      }

      // Delete non-persistent files
      for (const filePath of filesToDelete) {
        this.#sql.exec('DELETE FROM vfs_files WHERE file_path = ?', filePath)
      }
    } catch (error) {
      console.warn('Error during cleanup:', error)
    }
  }

  // VFS Interface Implementation

  jOpen(path: string, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      if (this.#openFiles.size >= this.#maxFiles) {
        return VFS.SQLITE_CANTOPEN
      }

      // Check if file exists
      const existingFile = this.#getFileMetadata(path)

      if (!existingFile && !(flags & VFS.SQLITE_OPEN_CREATE)) {
        return VFS.SQLITE_CANTOPEN
      }

      let metadata: FileMetadata

      if (existingFile) {
        metadata = existingFile
      } else {
        // Create new file
        const now = Math.floor(Date.now() / 1000)
        metadata = {
          path,
          size: 0,
          flags,
          created: now,
          modified: now,
        }

        this.#sql.exec(
          'INSERT INTO vfs_files (file_path, file_size, flags, created_at, modified_at) VALUES (?, ?, ?, ?, ?)',
          path,
          0,
          flags,
          now,
          now,
        )
      }

      // Store file handle
      this.#openFiles.set(fileId, {
        path,
        flags,
        metadata,
      })

      pOutFlags.setInt32(0, flags, true)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jOpen error:', error)
      return VFS.SQLITE_CANTOPEN
    }
  }

  jClose(fileId: number): number {
    this.#openFiles.delete(fileId)
    return VFS.SQLITE_OK
  }

  jRead(fileId: number, buffer: Uint8Array, offset: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) {
        return VFS.SQLITE_IOERR
      }

      const range = this.#blockManager.calculateBlockRange(offset, buffer.length)
      const blockIds = []
      for (let i = range.startBlock; i <= range.endBlock; i++) {
        blockIds.push(i)
      }

      const blocks = this.#blockManager.readBlocks(this.#sql, handle.path, blockIds)
      const data = this.#blockManager.assembleBlocks(blocks, range, buffer.length)

      buffer.set(data)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jRead error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jWrite(fileId: number, data: Uint8Array, offset: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) {
        return VFS.SQLITE_IOERR
      }

      // Split write data into blocks
      const writeBlocks = this.#blockManager.splitIntoBlocks(data, offset)
      const finalBlocks = new Map<number, Uint8Array>()

      for (const [blockId, blockInfo] of writeBlocks) {
        let blockData: Uint8Array

        if (blockInfo.blockOffset === 0 && blockInfo.data.length === this.#blockManager.getBlockSize()) {
          // Full block write
          blockData = blockInfo.data
        } else {
          // Partial block write - merge with existing data
          blockData = this.#blockManager.mergePartialBlock(
            this.#sql,
            handle.path,
            blockInfo.blockId,
            blockInfo.blockOffset,
            blockInfo.data,
          )
        }

        finalBlocks.set(blockId, blockData)
      }

      // Write blocks to SQL storage
      this.#blockManager.writeBlocks(this.#sql, handle.path, finalBlocks)

      // Update file size if necessary
      const newSize = Math.max(handle.metadata.size, offset + data.length)
      if (newSize !== handle.metadata.size) {
        this.#sql.exec('UPDATE vfs_files SET file_size = ? WHERE file_path = ?', newSize, handle.path)
        handle.metadata.size = newSize
      }

      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jWrite error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jTruncate(fileId: number, size: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) {
        return VFS.SQLITE_IOERR
      }

      // Calculate which block contains the new end of file
      const lastBlockId = Math.floor(size / this.#blockManager.getBlockSize())

      // Delete blocks beyond the truncation point
      this.#blockManager.deleteBlocksAfter(this.#sql, handle.path, lastBlockId + 1)

      // If truncating within a block, we need to truncate that block's data
      if (size % this.#blockManager.getBlockSize() !== 0) {
        const existingBlocks = this.#blockManager.readBlocks(this.#sql, handle.path, [lastBlockId])
        const blockData = existingBlocks.get(lastBlockId)

        if (blockData) {
          const truncatedBlock = blockData.slice(0, size % this.#blockManager.getBlockSize())
          const paddedBlock = new Uint8Array(this.#blockManager.getBlockSize())
          paddedBlock.set(truncatedBlock)

          const blocksToWrite = new Map([[lastBlockId, paddedBlock]])
          this.#blockManager.writeBlocks(this.#sql, handle.path, blocksToWrite)
        }
      }

      // Update file metadata
      this.#sql.exec('UPDATE vfs_files SET file_size = ? WHERE file_path = ?', size, handle.path)
      handle.metadata.size = size

      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jTruncate error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jSync(fileId: number, _flags: number): number {
    // SQL storage provides immediate durability, so sync is effectively a no-op
    const handle = this.#openFiles.get(fileId)
    if (!handle) {
      return VFS.SQLITE_IOERR
    }
    return VFS.SQLITE_OK
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) {
        return VFS.SQLITE_IOERR
      }

      pSize64.setBigInt64(0, BigInt(handle.metadata.size), true)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jFileSize error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jDelete(path: string, _syncDir: number): number {
    try {
      this.#sql.exec('DELETE FROM vfs_files WHERE file_path = ?', path)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jDelete error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jAccess(path: string, _flags: number, pResOut: DataView): number {
    try {
      const metadata = this.#getFileMetadata(path)
      pResOut.setInt32(0, metadata ? 1 : 0, true)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jAccess error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  jSectorSize(_fileId: number): number {
    return SECTOR_SIZE
  }

  jDeviceCharacteristics(_fileId: number): number {
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
  }

  // Helper methods

  #getFileMetadata(path: string): FileMetadata | undefined {
    try {
      const cursor = this.#sql.exec<{
        file_path: string
        file_size: number
        flags: number
        created_at: number
        modified_at: number
      }>('SELECT file_path, file_size, flags, created_at, modified_at FROM vfs_files WHERE file_path = ?', path)

      const row = cursor.one()
      return {
        path: row.file_path,
        size: row.file_size,
        flags: row.flags,
        created: row.created_at,
        modified: row.modified_at,
      }
    } catch {
      return undefined
    }
  }

  // Statistics and debugging

  getStats(): {
    activeFiles: number
    openFiles: number
    maxFiles: number
    blockSize: number
    totalStoredBytes: number
  } {
    try {
      const cursor = this.#sql.exec<{ total_files: number; total_bytes: number }>(
        'SELECT COUNT(*) as total_files, COALESCE(SUM(LENGTH(block_data)), 0) as total_bytes FROM vfs_files LEFT JOIN vfs_blocks USING (file_path)',
      )
      const stats = cursor.one()

      return {
        activeFiles: stats.total_files,
        openFiles: this.#openFiles.size,
        maxFiles: this.#maxFiles,
        blockSize: this.#blockManager.getBlockSize(),
        totalStoredBytes: stats.total_bytes,
      }
    } catch {
      return {
        activeFiles: 0,
        openFiles: this.#openFiles.size,
        maxFiles: this.#maxFiles,
        blockSize: this.#blockManager.getBlockSize(),
        totalStoredBytes: 0,
      }
    }
  }
}
