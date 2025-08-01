/// <reference types="vitest/globals" />

import type { CfWorker } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareSqlVFS } from '../../mod.ts'

describe('CloudflareSqlVFS - Core Functionality', () => {
  let vfs: CloudflareSqlVFS
  let mockSql: CfWorker.SqlStorage
  let mockDatabase: Map<string, any[]>
  let queryLog: string[]

  beforeEach(async () => {
    mockDatabase = new Map()
    queryLog = []

    // Mock SQL storage that mimics the Cloudflare DurableObject SQL API
    mockSql = {
      exec: <T extends Record<string, CfWorker.SqlStorageValue>>(
        query: string,
        ...bindings: any[]
      ): CfWorker.SqlStorageCursor<T> => {
        queryLog.push(`${query} [${bindings.join(', ')}]`)

        // Simple SQL parser for testing - handles basic CREATE, INSERT, SELECT, UPDATE, DELETE
        const normalizedQuery = query.trim().toUpperCase()

        if (
          normalizedQuery.includes('CREATE TABLE') ||
          normalizedQuery.includes('CREATE INDEX') ||
          normalizedQuery.includes('CREATE TRIGGER')
        ) {
          // Handle schema creation
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('INSERT OR REPLACE INTO VFS_BLOCKS')) {
          const [filePath, blockId, blockData] = bindings
          const key = `blocks:${filePath}`
          if (!mockDatabase.has(key)) {
            mockDatabase.set(key, [])
          }
          const blocks = mockDatabase.get(key)!
          const existingIndex = blocks.findIndex((b: any) => b.block_id === blockId)
          const blockEntry = { file_path: filePath, block_id: blockId, block_data: blockData }

          if (existingIndex >= 0) {
            blocks[existingIndex] = blockEntry
          } else {
            blocks.push(blockEntry)
          }
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('INSERT INTO VFS_FILES')) {
          const [filePath, fileSize, flags, createdAt, modifiedAt] = bindings
          mockDatabase.set(`file:${filePath}`, {
            file_path: filePath as string,
            file_size: fileSize as number,
            flags: flags as number,
            created_at: createdAt as number,
            modified_at: modifiedAt as number,
          } as any)
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('SELECT') && normalizedQuery.includes('FROM VFS_FILES')) {
          if (normalizedQuery.includes('WHERE FILE_PATH = ?')) {
            const [filePath] = bindings
            const fileData = mockDatabase.get(`file:${filePath}`)
            return createMockCursor(fileData ? [fileData] : ([] as any))
          }
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('SELECT') && normalizedQuery.includes('FROM VFS_BLOCKS')) {
          if (normalizedQuery.includes('WHERE FILE_PATH = ?')) {
            const filePath = bindings[0]
            const blocks = mockDatabase.get(`blocks:${filePath}`) || []

            if (normalizedQuery.includes('AND BLOCK_ID IN')) {
              const requestedBlockIds = bindings.slice(1)
              const matchingBlocks = blocks.filter((b: any) => requestedBlockIds.includes(b.block_id))
              return createMockCursor(matchingBlocks as any)
            }

            return createMockCursor(blocks as any)
          }
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('UPDATE VFS_FILES')) {
          if (normalizedQuery.includes('SET FILE_SIZE = ?')) {
            const [newSize, filePath] = bindings
            const fileData = mockDatabase.get(`file:${filePath}`) as any
            if (fileData) {
              fileData.file_size = newSize as number
              fileData.modified_at = Math.floor(Date.now() / 1000)
            }
          }
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('DELETE FROM VFS_BLOCKS')) {
          const [filePath, minBlockId] = bindings
          const blocks = mockDatabase.get(`blocks:${filePath}`)
          if (blocks) {
            const filteredBlocks = blocks.filter((b: any) => b.block_id < minBlockId)
            mockDatabase.set(`blocks:${filePath}`, filteredBlocks)
          }
          return createMockCursor([] as any)
        }

        if (normalizedQuery.startsWith('DELETE FROM VFS_FILES')) {
          const [filePath] = bindings
          mockDatabase.delete(`file:${filePath}`)
          mockDatabase.delete(`blocks:${filePath}`)
          return createMockCursor([] as any)
        }

        // Default empty result for unhandled queries
        console.warn('Unhandled query:', query, bindings)
        return createMockCursor([] as any)
      },

      get databaseSize(): number {
        return 1024 * 1024 // Mock 1MB database
      },

      Cursor: {} as any,
      Statement: {} as any,
    } as CfWorker.SqlStorage

    function createMockCursor<T extends Record<string, CfWorker.SqlStorageValue>>(
      data: T[],
    ): CfWorker.SqlStorageCursor<T> {
      let index = 0

      return {
        next: () => {
          if (index < data.length) {
            return { done: false, value: data[index++] }
          }
          return { done: true }
        },
        toArray: () => data,
        one: () => {
          if (data.length === 0) {
            throw new Error('No results')
          }
          return data[0]
        },
        raw: function* () {
          for (const item of data) {
            yield Object.values(item) as CfWorker.SqlStorageValue[]
          }
        },
        columnNames: Object.keys(data[0] || {}),
        get rowsRead() {
          return data.length
        },
        get rowsWritten() {
          return 0
        },
        [Symbol.iterator]: function* () {
          for (const item of data) {
            yield item
          }
        },
      } as CfWorker.SqlStorageCursor<T>
    }

    vfs = new CloudflareSqlVFS('test-sql-vfs', mockSql, {})
    await vfs.isReady()
  })

  describe('Basic File Operations', () => {
    it('should create and open files', async () => {
      const path = '/test/basic.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      const result = vfs.jOpen(path, fileId, flags, pOutFlags)
      expect(result).toBe(VFS.SQLITE_OK)
      expect(pOutFlags.getUint32(0, true)).toBe(flags)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Verify file was created in mock database
      expect(mockDatabase.has(`file:${path}`)).toBe(true)
    })

    it('should handle file access checks', async () => {
      const path = '/test/access.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // File doesn't exist initially
      const pResOut = new DataView(new ArrayBuffer(4))
      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)).toBe(VFS.SQLITE_OK)
      expect(pResOut.getUint32(0, true)).toBe(0)

      // Create file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      vfs.jClose(fileId)

      // File should exist now
      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)).toBe(VFS.SQLITE_OK)
      expect(pResOut.getUint32(0, true)).toBe(1)
    })

    it('should handle basic read/write operations', async () => {
      const path = '/test/readwrite.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data
      const testData = new TextEncoder().encode('Hello, SQL VFS!')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Read data back
      const readBuffer = new Uint8Array(testData.length)
      expect(vfs.jRead(fileId, readBuffer, 0)).toBe(VFS.SQLITE_OK)
      expect(readBuffer).toEqual(testData)

      vfs.jClose(fileId)
    })

    it('should handle file size operations', async () => {
      const path = '/test/size.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Initial size should be 0
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(0n)

      // Write data and check size
      const testData = new Uint8Array(1000)
      testData.fill(0xaa)
      vfs.jWrite(fileId, testData, 0)

      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(1000n)

      vfs.jClose(fileId)
    })

    it('should handle file truncation', async () => {
      const path = '/test/truncate.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data
      const testData = new Uint8Array(2000)
      testData.fill(0xbb)
      vfs.jWrite(fileId, testData, 0)

      // Truncate to smaller size
      expect(vfs.jTruncate(fileId, 500)).toBe(VFS.SQLITE_OK)

      // Verify size
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(500n)

      vfs.jClose(fileId)
    })

    it('should handle sync operations', async () => {
      const path = '/test/sync.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      const testData = new TextEncoder().encode('Sync test data')
      vfs.jWrite(fileId, testData, 0)

      // Test different sync modes - should all be no-ops for SQL VFS
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_OK)
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_FULL)).toBe(VFS.SQLITE_OK)
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_DATAONLY)).toBe(VFS.SQLITE_OK)

      vfs.jClose(fileId)
    })

    it('should handle file deletion', async () => {
      const path = '/test/delete.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Create file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      const testData = new TextEncoder().encode('Delete test')
      vfs.jWrite(fileId, testData, 0)
      vfs.jClose(fileId)

      // Delete file
      expect(vfs.jDelete(path, 0)).toBe(VFS.SQLITE_OK)

      // Verify file is gone
      expect(mockDatabase.has(`file:${path}`)).toBe(false)
      expect(mockDatabase.has(`blocks:${path}`)).toBe(false)
    })
  })

  describe('VFS Management', () => {
    it('should provide correct VFS characteristics', () => {
      expect(vfs.jSectorSize(1)).toBe(4096)
      expect(vfs.jDeviceCharacteristics(1)).toBe(VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN)
    })

    it('should handle multiple files', async () => {
      const files = [
        { path: '/test/file1.db', id: 1 },
        { path: '/test/file2.db', id: 2 },
        { path: '/test/file3.db', id: 3 },
      ]

      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open all files
      for (const file of files) {
        expect(vfs.jOpen(file.path, file.id, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      }

      // Write different data to each
      for (let i = 0; i < files.length; i++) {
        const data = new TextEncoder().encode(`File ${i + 1} data`)
        expect(vfs.jWrite(files[i]?.id ?? 0, data, 0)).toBe(VFS.SQLITE_OK)
      }

      // Read back and verify
      for (let i = 0; i < files.length; i++) {
        const expected = new TextEncoder().encode(`File ${i + 1} data`)
        const actual = new Uint8Array(expected.length)
        expect(vfs.jRead(files[i]?.id ?? 0, actual, 0)).toBe(VFS.SQLITE_OK)
        expect(actual).toEqual(expected)
      }

      // Close all files
      for (const file of files) {
        expect(vfs.jClose(file.id)).toBe(VFS.SQLITE_OK)
      }
    })

    it('should provide VFS statistics', () => {
      const stats = vfs.getStats()
      expect(stats).toHaveProperty('activeFiles')
      expect(stats).toHaveProperty('openFiles')
      expect(stats).toHaveProperty('maxFiles')
      expect(stats).toHaveProperty('blockSize')
      expect(stats).toHaveProperty('totalStoredBytes')
      expect(stats.blockSize).toBe(64 * 1024)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid file IDs', () => {
      const invalidFileId = 999
      const buffer = new Uint8Array(100)

      expect(vfs.jRead(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jTruncate(invalidFileId, 50)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jSync(invalidFileId, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jClose(invalidFileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle invalid paths', () => {
      const invalidPath = ''
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(invalidPath, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
    })

    it('should handle file operations on closed files', () => {
      const path = '/test/closed.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open and close file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      vfs.jClose(fileId)

      // Try to operate on closed file
      const buffer = new Uint8Array(10)
      expect(vfs.jRead(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
    })
  })

  describe('Constants and Compatibility', () => {
    it('should define correct VFS constants', () => {
      expect(VFS.SQLITE_OK).toBe(0)
      expect(VFS.SQLITE_IOERR).toBe(10)
      expect(VFS.SQLITE_CANTOPEN).toBe(14)
      expect(VFS.SQLITE_READONLY).toBe(8)
      expect(VFS.SQLITE_IOERR_SHORT_READ).toBe(522)
      expect(VFS.SQLITE_IOERR_WRITE).toBe(778)
      expect(VFS.SQLITE_IOERR_TRUNCATE).toBe(1546)
    })

    it('should handle VFS flags correctly', () => {
      expect(VFS.SQLITE_OPEN_CREATE).toBeTruthy()
      expect(VFS.SQLITE_OPEN_READWRITE).toBeTruthy()
      expect(VFS.SQLITE_OPEN_READONLY).toBeTruthy()
      expect(VFS.SQLITE_OPEN_MAIN_DB).toBeTruthy()
      expect(VFS.SQLITE_OPEN_WAL).toBeTruthy()
      expect(VFS.SQLITE_OPEN_MAIN_JOURNAL).toBeTruthy()
    })
  })
})
