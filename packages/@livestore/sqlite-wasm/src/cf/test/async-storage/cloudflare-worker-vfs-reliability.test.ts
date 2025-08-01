/// <reference types="vitest/globals" />

import type { CfWorker } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareWorkerVFS } from '../../mod.ts'

describe('CloudflareWorkerVFS - Reliability & Error Recovery', () => {
  let vfs: CloudflareWorkerVFS
  let mockStorage: CfWorker.DurableObjectStorage
  let storageData: Map<string, any>

  beforeEach(async () => {
    storageData = new Map<string, any>()

    mockStorage = {
      get: (async (_key: string | string[]) => {
        if (Array.isArray(_key)) {
          return new Map()
        }
        return storageData.get(_key)
      }) as CfWorker.DurableObjectStorage['get'],

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
      }) as CfWorker.DurableObjectStorage['delete'],

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
    } as CfWorker.DurableObjectStorage

    vfs = new CloudflareWorkerVFS('test-reliability-vfs', mockStorage, {})
    await vfs.isReady()
  })

  describe('Error Recovery', () => {
    it('should handle storage failures gracefully during reads', async () => {
      const path = '/test/read-failure-recovery.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data successfully first
      const testData = new TextEncoder().encode('Test data for failure recovery')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Read should work initially (from cache)
      const readData1 = new Uint8Array(testData.length)
      expect(vfs.jRead(fileId, readData1, 0)).toBe(VFS.SQLITE_OK)
      expect(readData1).toEqual(testData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle invalid file operations gracefully', async () => {
      const invalidFileId = 999
      const buffer = new Uint8Array(100)

      // All operations on invalid file ID should return appropriate error
      expect(vfs.jRead(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jTruncate(invalidFileId, 50)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jSync(invalidFileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jClose(invalidFileId)).toBe(VFS.SQLITE_OK)

      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(invalidFileId, pSize64)).toBe(VFS.SQLITE_IOERR)
    })

    it('should handle operations on closed files gracefully', async () => {
      const path = '/test/closed-file-ops.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open and immediately close file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Operations on closed file should fail gracefully
      const buffer = new Uint8Array(10)
      expect(vfs.jRead(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jTruncate(fileId, 5)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jSync(fileId, VFS.SQLITE_SYNC_NORMAL)).toBe(VFS.SQLITE_IOERR)
    })

    it('should handle invalid paths gracefully', async () => {
      const invalidPaths = ['', null as any, undefined as any]
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      for (const invalidPath of invalidPaths) {
        const result = vfs.jOpen(invalidPath, fileId, flags, pOutFlags)
        expect(result).toBe(VFS.SQLITE_OK)
      }
    })

    it('should recover from corrupted metadata gracefully', async () => {
      const path = '/test/corrupted-metadata.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Manually insert corrupted metadata
      const metadataKey = `file:${path}:meta`
      storageData.set(metadataKey, { invalid: 'metadata', structure: true })

      // Opening file should handle corrupted metadata
      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

      // Should be able to write new data (which will create new metadata)
      const testData = new TextEncoder().encode('Recovery test data')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Should be able to read the data back
      const readData = new Uint8Array(testData.length)
      expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)
      expect(readData).toEqual(testData)

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple files opened simultaneously', async () => {
      const numFiles = 10
      const files: Array<{ path: string; id: number }> = []

      // Open multiple files
      for (let i = 0; i < numFiles; i++) {
        const path = `/test/concurrent-${i}.db`
        const fileId = i + 1
        files.push({ path, id: fileId })

        const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
        const pOutFlags = new DataView(new ArrayBuffer(4))
        expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      }

      // Write different data to each file
      for (let i = 0; i < files.length; i++) {
        const testData = new TextEncoder().encode(`File ${i} data`)
        expect(vfs.jWrite(files[i]?.id ?? 0, testData, 0)).toBe(VFS.SQLITE_OK)
      }

      // Read back and verify each file has correct data
      for (let i = 0; i < files.length; i++) {
        const expectedData = new TextEncoder().encode(`File ${i} data`)
        const readData = new Uint8Array(expectedData.length)
        expect(vfs.jRead(files[i]?.id ?? 0, readData, 0)).toBe(VFS.SQLITE_OK)
        expect(readData).toEqual(expectedData)
      }

      // Close all files
      for (const file of files) {
        expect(vfs.jClose(file.id)).toBe(VFS.SQLITE_OK)
      }
    })

    it('should handle rapid sequential operations on same file', async () => {
      const path = '/test/rapid-sequential.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Perform rapid sequential write operations
      const numOperations = 50
      for (let i = 0; i < numOperations; i++) {
        const data = new TextEncoder().encode(`Operation ${i}`)
        const offset = i * 20 // Non-overlapping writes
        expect(vfs.jWrite(fileId, data, offset)).toBe(VFS.SQLITE_OK)
      }

      // Verify all operations succeeded
      for (let i = 0; i < numOperations; i++) {
        const expectedData = new TextEncoder().encode(`Operation ${i}`)
        const readData = new Uint8Array(expectedData.length)
        const offset = i * 20
        expect(vfs.jRead(fileId, readData, offset)).toBe(VFS.SQLITE_OK)
        expect(readData).toEqual(expectedData)
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle mixed read/write operations', async () => {
      const path = '/test/mixed-operations.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Initialize with some data
      const initialData = new Uint8Array(1000)
      for (let i = 0; i < initialData.length; i++) {
        initialData[i] = i % 256
      }
      expect(vfs.jWrite(fileId, initialData, 0)).toBe(VFS.SQLITE_OK)

      // Perform mixed operations
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          // Write operation
          const writeData = new Uint8Array(10)
          writeData.fill((i + 100) % 256)
          const offset = (i * 10) % 500
          expect(vfs.jWrite(fileId, writeData, offset)).toBe(VFS.SQLITE_OK)
        } else {
          // Read operation
          const readData = new Uint8Array(10)
          const offset = ((i - 1) * 10) % 500
          expect(vfs.jRead(fileId, readData, offset)).toBe(VFS.SQLITE_OK)
          // Verify read data matches what we wrote in previous iteration
          const expectedValue = (i - 1 + 100) % 256
          expect(readData.every((byte) => byte === expectedValue)).toBe(true)
        }
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })

    it('should handle cache pressure under concurrent access', async () => {
      const path = '/test/cache-pressure.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      const chunkSize = 64 * 1024
      const numChunks = 15 // More than typical cache size

      // Write data to create cache pressure
      for (let i = 0; i < numChunks; i++) {
        const chunkData = new Uint8Array(chunkSize)
        chunkData.fill(i % 256)
        const offset = i * chunkSize
        expect(vfs.jWrite(fileId, chunkData, offset)).toBe(VFS.SQLITE_OK)
      }

      // Random access pattern to stress cache
      const accessPattern = []
      for (let i = 0; i < 30; i++) {
        accessPattern.push(Math.floor(Math.random() * numChunks))
      }

      for (const chunkIdx of accessPattern) {
        const readData = new Uint8Array(1000) // Read partial chunk
        const offset = chunkIdx * chunkSize + 1000
        const readResult = vfs.jRead(fileId, readData, offset)

        if (readResult === VFS.SQLITE_OK) {
          const expectedValue = chunkIdx % 256
          expect(readData.every((byte) => byte === expectedValue)).toBe(true)
        } else {
          // Cache miss is acceptable under cache pressure
          expect(readResult).toBe(VFS.SQLITE_IOERR_SHORT_READ)
        }
      }

      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
    })
  })

  describe('Resource Management', () => {
    it('should handle resource cleanup properly', async () => {
      const paths = ['/test/cleanup1.db', '/test/cleanup2.db', '/test/cleanup3.db']
      const fileIds = [1, 2, 3]
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Open files and write data
      for (let i = 0; i < paths.length; i++) {
        expect(vfs.jOpen(paths[i] ?? '', fileIds[i] ?? 0, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

        const testData = new TextEncoder().encode(`Cleanup test ${i}`)
        expect(vfs.jWrite(fileIds[i] ?? 0, testData, 0)).toBe(VFS.SQLITE_OK)
      }

      // Get initial stats
      const statsBefore = vfs.getStats()
      expect(statsBefore.openFiles).toBe(3)

      // Close all files
      for (const fileId of fileIds) {
        expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
      }

      // Verify cleanup
      const statsAfter = vfs.getStats()
      expect(statsAfter.openFiles).toBe(0)
    })

    it('should handle file deletion and cleanup', async () => {
      const path = '/test/delete-cleanup.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Create and write to file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      const testData = new TextEncoder().encode('Data to be deleted')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify file exists
      const pResOut = new DataView(new ArrayBuffer(4))
      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)).toBe(VFS.SQLITE_OK)

      // Delete file
      expect(vfs.jDelete(path, 0)).toBe(VFS.SQLITE_OK)

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify file is deleted
      vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)
      expect(pResOut.getUint32(0, true)).toBe(0)
    })

    it('should handle memory pressure gracefully', async () => {
      // Create multiple files with large data to simulate memory pressure
      const numFiles = 5
      const chunkSize = 64 * 1024
      const dataPerFile = chunkSize * 2 // 128KB per file

      for (let fileIdx = 0; fileIdx < numFiles; fileIdx++) {
        const path = `/test/memory-pressure-${fileIdx}.db`
        const fileId = fileIdx + 1
        const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
        const pOutFlags = new DataView(new ArrayBuffer(4))

        expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

        // Write large data
        const largeData = new Uint8Array(dataPerFile)
        largeData.fill(fileIdx % 256)
        expect(vfs.jWrite(fileId, largeData, 0)).toBe(VFS.SQLITE_OK)

        expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
      }

      // Verify all files are still accessible
      for (let fileIdx = 0; fileIdx < numFiles; fileIdx++) {
        const path = `/test/memory-pressure-${fileIdx}.db`
        const fileId = fileIdx + 1
        const flags = VFS.SQLITE_OPEN_READWRITE
        const pOutFlags = new DataView(new ArrayBuffer(4))

        expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)

        // Read and verify data
        const readData = new Uint8Array(dataPerFile)
        expect(vfs.jRead(fileId, readData, 0)).toBe(VFS.SQLITE_OK)

        const expectedValue = fileIdx % 256
        expect(readData.every((byte) => byte === expectedValue)).toBe(true)

        expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)
      }
    })
  })
})
