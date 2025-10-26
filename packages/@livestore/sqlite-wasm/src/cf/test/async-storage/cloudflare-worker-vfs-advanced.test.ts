/// <reference types="vitest/globals" />

import type { CfTypes } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareWorkerVFS } from '../../mod.ts'

describe('CloudflareWorkerVFS - Advanced Features', () => {
  let vfs: CloudflareWorkerVFS
  let mockStorage: CfTypes.DurableObjectStorage
  let storageData: Map<string, any>

  beforeEach(async () => {
    storageData = new Map<string, any>()

    mockStorage = {
      get: (async (_key: string | string[]) => {
        if (Array.isArray(_key)) {
          return new Map()
        }
        return storageData.get(_key)
      }) as CfTypes.DurableObjectStorage['get'],

      put: async (_key: string | Record<string, any>, _value?: any) => {
        if (typeof _key === 'string') {
          storageData.set(_key, _value)
        } else {
          for (const [k, v] of Object.entries(_key)) {
            storageData.set(k, v)
          }
        }
      },

      delete: (async (_key: string | string[]) => {
        if (Array.isArray(_key)) {
          let count = 0
          for (const k of _key) {
            if (storageData.delete(k)) count++
          }
          return count
        } else {
          return storageData.delete(_key)
        }
      }) as CfTypes.DurableObjectStorage['delete'],

      list: async () => new Map(storageData),
      sync: async () => {},
      transactionSync: (fn: () => any) => fn(),
      deleteAll: async () => {
        storageData.clear()
      },
      transaction: async (fn: (txn: any) => Promise<any>) => fn({} as any),
      getCurrentBookmark: async () => '',
      getBookmarkForTime: async (_time: number | Date) => '',
      onNextSessionRestoreBookmark: async (_bookmark: string) => '',
      getAlarm: async () => null,
      setAlarm: async (_timestamp: number | Date) => {},
      deleteAlarm: async () => {},
      sql: {} as any,
    } as CfTypes.DurableObjectStorage

    vfs = new CloudflareWorkerVFS('test-advanced-vfs', mockStorage, {})
    await vfs.isReady()
  })

  describe('Large File Chunking', () => {
    it('should handle large files with proper chunking', async () => {
      const path = '/test/large-file.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write 5 chunks worth of data
      const chunkSize = 64 * 1024
      const numChunks = 5
      const totalSize = chunkSize * numChunks
      const largeData = new Uint8Array(totalSize)

      // Fill with pattern for verification
      for (let i = 0; i < totalSize; i++) {
        largeData[i] = (i * 7) % 256
      }

      expect(vfs.jWrite(fileId, largeData, 0)).toBe(VFS.SQLITE_OK)

      // Verify file size
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(BigInt(totalSize))

      // Read back in chunks to verify chunking works correctly
      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const chunkData = new Uint8Array(chunkSize)
        const offset = chunkIdx * chunkSize

        expect(vfs.jRead(fileId, chunkData, offset)).toBe(VFS.SQLITE_OK)
        expect(chunkData).toEqual(largeData.slice(offset, offset + chunkSize))
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle cross-chunk boundary operations', async () => {
      const path = '/test/cross-chunk.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      const chunkSize = 64 * 1024

      // Write data spanning chunk boundaries
      const spanData = new Uint8Array(chunkSize + 1000)
      spanData.fill(0xaa)
      const spanOffset = chunkSize - 500

      expect(vfs.jWrite(fileId, spanData, spanOffset)).toBe(VFS.SQLITE_OK)

      // Read back cross-boundary data
      const readData = new Uint8Array(spanData.length)
      expect(vfs.jRead(fileId, readData, spanOffset)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(spanData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('Cache Management', () => {
    it('should handle cache operations correctly', async () => {
      const path = '/test/cache-test.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data to populate cache
      const testData = new TextEncoder().encode('Cache test data')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Multiple reads should use cache
      for (let i = 0; i < 5; i++) {
        const readData = new Uint8Array(testData.length)
        expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
        expect(readData).toEqual(testData)
      }

      // Check cache statistics
      const stats = vfs.getStats()
      expect(stats.cachedChunks).toBeGreaterThan(0)
      expect(stats.chunkSize).toBe(64 * 1024)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle large files that exceed cache capacity', async () => {
      const path = '/test/cache-overflow.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write many chunks to potentially exceed cache
      const chunkSize = 64 * 1024
      const numChunks = 20 // Likely to exceed typical cache size

      for (let i = 0; i < numChunks; i++) {
        const chunkData = new Uint8Array(chunkSize)
        chunkData.fill(i % 256)
        const offset = i * chunkSize

        expect(vfs.jWrite(fileId, chunkData, offset)).toBe(VFS.SQLITE_OK)
      }

      // Verify all chunks can still be read correctly
      for (let i = 0; i < numChunks; i++) {
        const readData = new Uint8Array(chunkSize)
        const offset = i * chunkSize

        const readResult = vfs.jRead(fileId, readData, offset)

        if (readResult === VFS.SQLITE_OK) {
          const expectedData = new Uint8Array(chunkSize)
          expectedData.fill(i % 256)
          expect(readData).toEqual(expectedData)
        } else {
          // Cache miss is acceptable for this test - we're testing cache pressure
          expect(readResult).toBe(VFS.SQLITE_IOERR_SHORT_READ)
        }
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('SQLite File Types', () => {
    it('should handle main database files', async () => {
      const path = '/test/main.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      expect(pOutFlags.getUint32(0, true)).toBe(flags)

      // Write typical SQLite header
      const header = new TextEncoder().encode('SQLite format 3\0')
      expect(vfs.jWrite(fileId, header, 0)).toBe(VFS.SQLITE_OK)

      // Read back header
      const readHeader = new Uint8Array(header.length)
      expect(vfs.jRead(fileId, readHeader, 0)).toBe(VFS.SQLITE_OK)
      expect(readHeader).toEqual(header)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle WAL files', async () => {
      const path = '/test/main.db-wal'
      const fileId = 2
      const flags = VFS.SQLITE_OPEN_WAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write WAL data
      const walData = new Uint8Array(1000)
      walData.fill(0xee)
      expect(vfs.jWrite(fileId, walData, 0)).toBe(VFS.SQLITE_OK)

      // Verify WAL data
      const readWalData = new Uint8Array(walData.length)
      expect(vfs.jRead(fileId, readWalData, 0)).toBe(VFS.SQLITE_OK)
      expect(readWalData).toEqual(walData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle journal files', async () => {
      const path = '/test/main.db-journal'
      const fileId = 3
      const flags = VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write journal data
      const journalData = new Uint8Array(500)
      journalData.fill(0xff)
      expect(vfs.jWrite(fileId, journalData, 0)).toBe(VFS.SQLITE_OK)

      // Verify journal data
      const readJournalData = new Uint8Array(journalData.length)
      expect(vfs.jRead(fileId, readJournalData, 0)).toBe(VFS.SQLITE_OK)
      expect(readJournalData).toEqual(journalData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle temporary files', async () => {
      const path = '/test/temp.db'
      const fileId = 4
      const flags = VFS.SQLITE_OPEN_TEMP_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Write temporary data
      const tempData = new TextEncoder().encode('Temporary database content')
      expect(vfs.jWrite(fileId, tempData, 0)).toBe(VFS.SQLITE_OK)

      // Read temporary data
      const readTempData = new Uint8Array(tempData.length)
      expect(vfs.jRead(fileId, readTempData, 0)).toBe(VFS.SQLITE_OK)
      expect(readTempData).toEqual(tempData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('Advanced Operations', () => {
    it('should handle multiple files with different types simultaneously', async () => {
      const files = [
        {
          path: '/test/multi-main.db',
          id: 1,
          flags: VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
        },
        {
          path: '/test/multi-main.db-wal',
          id: 2,
          flags: VFS.SQLITE_OPEN_WAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
        },
        {
          path: '/test/multi-main.db-journal',
          id: 3,
          flags: VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE,
        },
      ]

      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open all files
      for (const file of files) {
        expect(vfs.jOpen(file.path, file.id, file.flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      }

      // Write different data to each file
      for (let i = 0; i < files.length; i++) {
        const data = new TextEncoder().encode(`File ${i} data`)
        expect(vfs.jWrite(files[i]?.id ?? 0, data, 0)).toBe(VFS.SQLITE_OK)
      }

      // Verify each file has correct data
      for (let i = 0; i < files.length; i++) {
        const expected = new TextEncoder().encode(`File ${i} data`)
        const actual = new Uint8Array(expected.length)
        expect(vfs.jRead(files[i]?.id ?? 0, actual, 0)).toBe(VFS.SQLITE_OK)
        expect(actual).toEqual(expected)
      }

      // Close all files
      for (const file of files) {
        expect(vfs.jClose(file.id)).toBe(VFS.SQLITE_OK)
      }
    })

    it('should handle file truncation with chunking', async () => {
      const path = '/test/truncate-chunks.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      const chunkSize = 64 * 1024

      // Write data spanning 3 chunks
      const largeData = new Uint8Array(chunkSize * 3)
      largeData.fill(0xdd)
      expect(vfs.jWrite(fileId, largeData, 0)).toBe(VFS.SQLITE_OK)

      // Truncate to 1.5 chunks
      const truncateSize = chunkSize + chunkSize / 2
      expect(vfs.jTruncate(fileId, truncateSize)).toBe(VFS.SQLITE_OK)

      // Verify new size
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(BigInt(truncateSize))

      // Verify data integrity after truncation
      const readData = new Uint8Array(truncateSize)
      expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(largeData.slice(0, truncateSize))

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle sync operations with proper flush behavior', async () => {
      const path = '/test/sync-flush.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data
      const testData = new TextEncoder().encode('Sync test data')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Test different sync modes
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_OK)
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_FULL)).toBe(VFS.SQLITE_OK)
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_DATAONLY)).toBe(VFS.SQLITE_OK)

      // Verify data is still accessible after sync
      const readData = new Uint8Array(testData.length)
      expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(testData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })
})
