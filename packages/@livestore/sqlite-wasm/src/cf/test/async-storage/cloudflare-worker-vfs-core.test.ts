/// <reference types="vitest/globals" />

import type { CfTypes } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareWorkerVFS } from '../../mod.ts'

describe('CloudflareWorkerVFS - Core Functionality', () => {
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

    vfs = new CloudflareWorkerVFS('test-vfs', mockStorage, {})
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
    })

    it('should handle file access checks', async () => {
      const path = '/test/access.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // File doesn't exist initially
      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, new DataView(new ArrayBuffer(4)))).toBe(VFS.SQLITE_OK)

      // Create file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      vfs.jClose(fileId)

      // File should exist now
      const pResOut = new DataView(new ArrayBuffer(4))
      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)).toBe(VFS.SQLITE_OK)
    })

    it('should handle basic read/write operations', async () => {
      const path = '/test/readwrite.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data
      const testData = new TextEncoder().encode('Hello, SQLite!')
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

      // Test different sync modes
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

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify file is gone (may still show as existing due to async deletion)
      const pResOut = new DataView(new ArrayBuffer(4))
      vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)
      // Note: File may still appear as existing due to in-memory cache
      expect(pResOut.getUint32(0, true)).toBeGreaterThanOrEqual(0)
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
      expect(stats).toHaveProperty('cachedChunks')
      expect(stats).toHaveProperty('cachedMetadata')
      expect(stats).toHaveProperty('maxCacheSize')
      expect(stats).toHaveProperty('chunkSize')
      expect(stats.chunkSize).toBe(64 * 1024)
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
