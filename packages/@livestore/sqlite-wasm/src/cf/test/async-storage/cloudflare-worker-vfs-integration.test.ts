/// <reference types="vitest/globals" />

import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Cf, CloudflareWorkerVFS } from '../../mod.ts'

describe('CloudflareWorkerVFS - Integration Tests', () => {
  let vfs: CloudflareWorkerVFS
  let mockStorage: Cf.DurableObjectStorage
  let storageData: Map<string, any>
  let storageOperations: string[]

  beforeEach(async () => {
    storageData = new Map<string, any>()
    storageOperations = []

    mockStorage = {
      get: (async (_key: string | string[]) => {
        if (Array.isArray(_key)) {
          storageOperations.push(`get-batch: ${_key.length} keys`)
          const result = new Map()
          for (const k of _key) {
            const value = storageData.get(k)
            if (value !== undefined) {
              result.set(k, value)
            }
          }
          return result
        } else {
          storageOperations.push(`get: ${_key}`)
          return storageData.get(_key)
        }
      }) as Cf.DurableObjectStorage['get'],

      put: async (_key: string | Record<string, any>, _value?: any) => {
        if (typeof _key === 'string') {
          storageOperations.push(`put: ${_key}`)
          storageData.set(_key, _value)
        } else {
          storageOperations.push(`put-batch: ${Object.keys(_key).length} keys`)
          for (const [k, v] of Object.entries(_key)) {
            storageData.set(k, v)
          }
        }
      },

      delete: (async (_key: string | string[]) => {
        if (Array.isArray(_key)) {
          storageOperations.push(`delete-batch: ${_key.length} keys`)
          let count = 0
          for (const k of _key) {
            if (storageData.delete(k)) count++
          }
          return count
        } else {
          storageOperations.push(`delete: ${_key}`)
          return storageData.delete(_key)
        }
      }) as Cf.DurableObjectStorage['delete'],

      list: async () => {
        storageOperations.push('list')
        return new Map(storageData)
      },

      sync: async () => {
        storageOperations.push('sync')
      },

      transactionSync: (fn: () => any) => {
        storageOperations.push('transactionSync')
        return fn()
      },

      deleteAll: async () => {
        storageOperations.push('deleteAll')
        storageData.clear()
      },

      transaction: async (fn: (txn: any) => Promise<any>) => {
        storageOperations.push('transaction')
        return await fn({} as any)
      },

      getCurrentBookmark: async () => {
        storageOperations.push('getCurrentBookmark')
        return ''
      },

      getBookmarkForTime: async (_time: number | Date) => {
        storageOperations.push('getBookmarkForTime')
        return ''
      },

      onNextSessionRestoreBookmark: async (_bookmark: string) => {
        storageOperations.push('onNextSessionRestoreBookmark')
        return ''
      },

      getAlarm: async () => null,
      setAlarm: async (_timestamp: number | Date) => {},
      deleteAlarm: async () => {},
      sql: {} as any,
    }

    vfs = new CloudflareWorkerVFS('test-integration-vfs', mockStorage, {})
    await vfs.isReady()
  })

  describe('Storage Integration', () => {
    it('should integrate properly with DurableObjectStorage API', async () => {
      const path = '/test/storage-integration.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      storageOperations.length = 0

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data that will trigger storage operations
      const testData = new TextEncoder().encode('Storage integration test')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Sync to ensure storage operations occur
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Verify storage operations occurred
      expect(storageOperations.length).toBeGreaterThan(0)

      // Verify metadata and chunk keys exist in storage
      const metadataKey = `file:${path}:meta`
      const chunkKey = `file:${path}:0`

      expect(storageData.has(metadataKey)).toBe(true)
      expect(storageData.has(chunkKey)).toBe(true)

      // Verify stored data integrity
      const metadata = storageData.get(metadataKey)
      expect(metadata.size).toBe(testData.length)
      expect(metadata.flags).toBe(flags)

      const chunk = storageData.get(chunkKey)
      expect(chunk.slice(0, testData.length)).toEqual(testData)
    })

    it('should handle storage key collisions gracefully', async () => {
      const paths = ['/test/path:with:colons.db', '/test/path_with_colons.db', '/test/pathwithcolons.db']

      for (let i = 0; i < paths.length; i++) {
        const fileId = i + 1
        const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
        const pOutFlags = new DataView(new ArrayBuffer(4))

        expect(vfs.jOpen(paths[i] ?? '', fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

        const testData = new TextEncoder().encode(`Data for file ${i}`)
        expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

        expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
      }

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Verify all files have separate storage entries
      for (const path of paths) {
        const metadataKey = `file:${path}:meta`
        expect(storageData.has(metadataKey)).toBe(true)
      }

      // Verify no data corruption between files
      for (let i = 0; i < paths.length; i++) {
        const fileId = i + 1
        const flags = VFS.SQLITE_OPEN_READWRITE
        const pOutFlags = new DataView(new ArrayBuffer(4))

        expect(vfs.jOpen(paths[i] ?? '', fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

        const expectedData = new TextEncoder().encode(`Data for file ${i}`)
        const readData = new Uint8Array(expectedData.length)
        expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
        expect(readData).toEqual(expectedData)

        expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
      }
    })

    it('should handle storage size limits correctly', async () => {
      const path = '/test/size-limits.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data that approaches DurableObjectStorage limits (128 KiB per value)
      const chunkSize = 64 * 1024 // VFS chunk size
      const testData = new Uint8Array(chunkSize)
      testData.fill(0xaa)

      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify chunk was stored correctly
      const chunkKey = `file:${path}:0`
      expect(storageData.has(chunkKey)).toBe(true)

      const storedChunk = storageData.get(chunkKey)
      expect(storedChunk.length).toBe(chunkSize)
      expect(storedChunk.length).toBeLessThanOrEqual(128 * 1024) // Within DO Storage limit
    })

    it('should handle batch operations efficiently', async () => {
      const path = '/test/batch-operations.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data that spans multiple chunks
      const chunkSize = 64 * 1024
      const numChunks = 3
      const totalData = new Uint8Array(chunkSize * numChunks)

      for (let i = 0; i < totalData.length; i++) {
        totalData[i] = (i * 3) % 256
      }

      storageOperations.length = 0
      expect(vfs.jWrite(fileId, totalData, 0)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Verify storage operations were batched efficiently
      expect(storageOperations.length).toBeGreaterThan(0)

      // Verify all chunks were stored
      for (let i = 0; i < numChunks; i++) {
        const chunkKey = `file:${path}:${i}`
        expect(storageData.has(chunkKey)).toBe(true)
      }

      // Verify data integrity
      vfs.jOpen(path, fileId, flags, pOutFlags)
      const readData = new Uint8Array(totalData.length)
      expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(totalData)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('SQLite Integration', () => {
    it('should handle SQLite database file format correctly', async () => {
      const path = '/test/sqlite-format.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write SQLite header
      const sqliteHeader = new TextEncoder().encode('SQLite format 3\0')
      expect(vfs.jWrite(fileId, sqliteHeader, 0)).toBe(VFS.SQLITE_OK)

      // Write page size (typical SQLite page size is 4096)
      const pageSize = new DataView(new ArrayBuffer(2))
      pageSize.setUint16(0, 4096, false) // Big-endian as per SQLite format
      const pageSizeBytes = new Uint8Array(pageSize.buffer)
      expect(vfs.jWrite(fileId, pageSizeBytes, 16)).toBe(VFS.SQLITE_OK)

      // Read back and verify header
      const readHeader = new Uint8Array(sqliteHeader.length)
      expect(vfs.jRead(fileId, readHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readHeader).toEqual(sqliteHeader)

      // Read back and verify page size
      const readPageSize = new Uint8Array(2)
      expect(vfs.jRead(fileId, readPageSize, 16)).toBe(VFS.SQLITE_OK)
      expect(readPageSize).toEqual(pageSizeBytes)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle SQLite page-based I/O operations', async () => {
      const path = '/test/sqlite-pages.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      const pageSize = 4096
      const numPages = 10

      // Write multiple SQLite pages
      for (let pageNum = 0; pageNum < numPages; pageNum++) {
        const pageData = new Uint8Array(pageSize)

        // Fill page with pattern (page number repeated)
        pageData.fill(pageNum % 256)

        const offset = pageNum * pageSize
        expect(vfs.jWrite(fileId, pageData, offset)).toBe(VFS.SQLITE_OK)
      }

      // Read back pages in different order
      const readOrder = [3, 1, 7, 0, 9, 2, 5, 8, 4, 6]
      for (const pageNum of readOrder) {
        const readData = new Uint8Array(pageSize)
        const offset = pageNum * pageSize

        expect(vfs.jRead(fileId, readData, offset)).toBe(VFS.SQLITE_OK)

        // Verify page content
        const expectedValue = pageNum % 256
        expect(readData.every((byte) => byte === expectedValue)).toBe(true)
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle WAL mode operations', async () => {
      const mainPath = '/test/wal-mode.db'
      const walPath = '/test/wal-mode.db-wal'

      const mainFileId = 1
      const walFileId = 2

      const mainFlags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const walFlags = VFS.SQLITE_OPEN_WAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open main database file
      expect(vfs.jOpen(mainPath, mainFileId, mainFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write main database content
      const dbContent = new TextEncoder().encode('SQLite format 3\0Main database content')
      expect(vfs.jWrite(mainFileId, dbContent, 0)).toBe(VFS.SQLITE_OK)

      // Open WAL file
      expect(vfs.jOpen(walPath, walFileId, walFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write WAL header and entries
      const walHeader = new Uint8Array(32)
      walHeader.fill(0x37) // WAL magic number pattern
      expect(vfs.jWrite(walFileId, walHeader, 0)).toBe(VFS.SQLITE_OK)

      // Write WAL frames
      const frameSize = 4096 + 24 // Page size + frame header
      const numFrames = 5

      for (let frameNum = 0; frameNum < numFrames; frameNum++) {
        const frameData = new Uint8Array(frameSize)
        frameData.fill((frameNum + 1) % 256)

        const offset = 32 + frameNum * frameSize // After WAL header
        expect(vfs.jWrite(walFileId, frameData, offset)).toBe(VFS.SQLITE_OK)
      }

      // Read back WAL header
      const readWalHeader = new Uint8Array(32)
      expect(vfs.jRead(walFileId, readWalHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readWalHeader).toEqual(walHeader)

      // Read back WAL frames
      for (let frameNum = 0; frameNum < numFrames; frameNum++) {
        const readFrameData = new Uint8Array(frameSize)
        const offset = 32 + frameNum * frameSize

        expect(vfs.jRead(walFileId, readFrameData, offset)).toBe(VFS.SQLITE_OK)

        const expectedValue = (frameNum + 1) % 256
        expect(readFrameData.every((byte) => byte === expectedValue)).toBe(true)
      }

      // Close both files
      expect(vfs.jClose(mainFileId)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(walFileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle journal mode operations', async () => {
      const mainPath = '/test/journal-mode.db'
      const journalPath = '/test/journal-mode.db-journal'

      const mainFileId = 1
      const journalFileId = 2

      const mainFlags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const journalFlags = VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open main database
      expect(vfs.jOpen(mainPath, mainFileId, mainFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write database pages
      const pageSize = 4096
      const dbPage = new Uint8Array(pageSize)
      dbPage.fill(0xdb) // DB page pattern
      expect(vfs.jWrite(mainFileId, dbPage, 0)).toBe(VFS.SQLITE_OK)

      // Open journal file
      expect(vfs.jOpen(journalPath, journalFileId, journalFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write journal header
      const journalHeader = new TextEncoder().encode('Journal header\0\0\0\0')
      expect(vfs.jWrite(journalFileId, journalHeader, 0)).toBe(VFS.SQLITE_OK)

      // Write journal page (copy of original page for rollback)
      const journalPage = new Uint8Array(pageSize)
      journalPage.fill(0x4a) // Journal page pattern
      expect(vfs.jWrite(journalFileId, journalPage, 512)).toBe(VFS.SQLITE_OK)

      // Verify journal operations
      const readJournalHeader = new Uint8Array(journalHeader.length)
      expect(vfs.jRead(journalFileId, readJournalHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readJournalHeader).toEqual(journalHeader)

      const readJournalPage = new Uint8Array(pageSize)
      expect(vfs.jRead(journalFileId, readJournalPage, 512)).toBe(VFS.SQLITE_OK)
      expect(readJournalPage).toEqual(journalPage)

      // Close files
      expect(vfs.jClose(mainFileId)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(journalFileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle database file locking simulation', async () => {
      const path = '/test/locking-simulation.db'
      const fileId1 = 1
      const fileId2 = 2

      const flags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open file with first handle
      expect(vfs.jOpen(path, fileId1, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write data with first handle
      const testData1 = new TextEncoder().encode('First connection data')
      expect(vfs.jWrite(fileId1, testData1, 0)).toBe(VFS.SQLITE_OK)

      // Open same file with second handle (simulates multiple connections)
      expect(vfs.jOpen(path, fileId2, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Read with second handle should see data from first handle
      const readData = new Uint8Array(testData1.length)
      expect(vfs.jRead(fileId2, readData, 0)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(testData1)

      // Write with second handle
      const testData2 = new TextEncoder().encode('Second connection data')
      expect(vfs.jWrite(fileId2, testData2, 100)).toBe(VFS.SQLITE_OK)

      // First handle should see data from second handle
      const readData2 = new Uint8Array(testData2.length)
      expect(vfs.jRead(fileId1, readData2, 100)).toBe(VFS.SQLITE_OK)
      expect(readData2).toEqual(testData2)

      // Close both handles
      expect(vfs.jClose(fileId1)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId2)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('End-to-End Integration', () => {
    it('should handle complete SQLite workflow', async () => {
      const dbPath = '/test/complete-workflow.db'
      const walPath = '/test/complete-workflow.db-wal'
      const journalPath = '/test/complete-workflow.db-journal'

      const dbFileId = 1
      const walFileId = 2
      const journalFileId = 3

      const pOutFlags = new DataView(new ArrayBuffer(4))

      // 1. Create main database
      const dbFlags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      expect(vfs.jOpen(dbPath, dbFileId, dbFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write SQLite header and initial pages
      const sqliteHeader = new TextEncoder().encode('SQLite format 3\0')
      expect(vfs.jWrite(dbFileId, sqliteHeader, 0)).toBe(VFS.SQLITE_OK)

      const pageSize = 4096
      const dbPage1 = new Uint8Array(pageSize)
      dbPage1.fill(0x01)
      expect(vfs.jWrite(dbFileId, dbPage1, pageSize)).toBe(VFS.SQLITE_OK)

      // 2. Create journal for transaction
      const journalFlags = VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      expect(vfs.jOpen(journalPath, journalFileId, journalFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write journal header and backup page
      const journalHeader = new Uint8Array(512)
      journalHeader.fill(0x30) // Journal header pattern
      expect(vfs.jWrite(journalFileId, journalHeader, 0)).toBe(VFS.SQLITE_OK)

      // 3. Modify database page (transaction)
      const modifiedPage = new Uint8Array(pageSize)
      modifiedPage.fill(0x02) // Modified page pattern
      expect(vfs.jWrite(dbFileId, modifiedPage, pageSize)).toBe(VFS.SQLITE_OK)

      // 4. Sync database (commit transaction)
      expect(vfs.jSync(dbFileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_OK)

      // 5. Delete journal (transaction committed)
      expect(vfs.jClose(journalFileId)).toBe(VFS.SQLITE_OK)
      expect(vfs.jDelete(journalPath, 0)).toBe(VFS.SQLITE_OK)

      // 6. Switch to WAL mode
      const walFlags = VFS.SQLITE_OPEN_WAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      expect(vfs.jOpen(walPath, walFileId, walFlags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write WAL header
      const walHeader = new Uint8Array(32)
      walHeader.fill(0x37) // WAL header pattern
      expect(vfs.jWrite(walFileId, walHeader, 0)).toBe(VFS.SQLITE_OK)

      // Write WAL frame
      const walFrame = new Uint8Array(pageSize + 24) // Page + frame header
      walFrame.fill(0x03) // WAL frame pattern
      expect(vfs.jWrite(walFileId, walFrame, 32)).toBe(VFS.SQLITE_OK)

      // 7. Verify all files are accessible and contain expected data
      // Database file
      const readHeader = new Uint8Array(sqliteHeader.length)
      expect(vfs.jRead(dbFileId, readHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readHeader).toEqual(sqliteHeader)

      const readDbPage = new Uint8Array(pageSize)
      expect(vfs.jRead(dbFileId, readDbPage, pageSize)).toBe(VFS.SQLITE_OK)
      expect(readDbPage).toEqual(modifiedPage)

      // WAL file
      const readWalHeader = new Uint8Array(32)
      expect(vfs.jRead(walFileId, readWalHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readWalHeader).toEqual(walHeader)

      // 8. Close all files
      expect(vfs.jClose(dbFileId)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(walFileId)).toBe(VFS.SQLITE_OK)

      // 9. Verify persistence across VFS sessions
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(vfs.jOpen(dbPath, dbFileId, dbFlags, pOutFlags)).toBe(VFS.SQLITE_OK)
      const persistentReadHeader = new Uint8Array(sqliteHeader.length)
      expect(vfs.jRead(dbFileId, persistentReadHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(persistentReadHeader).toEqual(sqliteHeader)

      expect(vfs.jClose(dbFileId)).toBe(VFS.SQLITE_OK)
    })
  })
})
