/// <reference types="vitest/globals" />

import type { CfTypes } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { CloudflareDurableObjectVFS } from '../../mod.ts'

const PAGE_SIZE = 8 * 1024

const makePage = (fillByte: number, text?: string): Uint8Array => {
  const page = new Uint8Array(PAGE_SIZE)
  page.fill(fillByte)

  if (text !== undefined) {
    page.set(new TextEncoder().encode(text))
  }

  return page
}

describe('CloudflareDurableObjectVFS - Core Functionality', () => {
  let vfs: CloudflareDurableObjectVFS
  let mockSql: CfTypes.SqlStorage
  /** In-memory page store keyed by file_path and page_no */
  let mockPages: Map<string, Map<number, Uint8Array>>
  let queryLog: string[]

  beforeEach(async () => {
    mockPages = new Map()
    queryLog = []

    const getOrCreateFilePages = (filePath: string) => {
      let pages = mockPages.get(filePath)

      if (pages === undefined) {
        pages = new Map()
        mockPages.set(filePath, pages)
      }

      return pages
    }

    // Mock SQL storage that mimics the Cloudflare DurableObject SQL API
    mockSql = {
      exec: <T extends Record<string, CfTypes.SqlStorageValue>>(
        query: string,
        ...bindings: any[]
      ): CfTypes.SqlStorageCursor<T> => {
        queryLog.push(`${query} [${bindings.join(', ')}]`)

        const normalizedQuery = query.trim().replace(/\s+/g, ' ').toUpperCase()

        if (normalizedQuery.includes('CREATE TABLE')) {
          return createMockCursor([] as any)
        }

        // INSERT OR REPLACE INTO vfs_pages (file_path, page_no, page_data) VALUES (?, ?, ?)
        if (normalizedQuery.startsWith('INSERT OR REPLACE INTO VFS_PAGES')) {
          const [filePath, pageNo, pageData] = bindings
          getOrCreateFilePages(filePath as string).set(
            pageNo as number,
            pageData instanceof Uint8Array ? pageData : new Uint8Array(pageData),
          )
          return createMockCursor([] as any)
        }

        // SELECT page_data FROM vfs_pages WHERE file_path = ? AND page_no = ?
        if (normalizedQuery.startsWith('SELECT PAGE_DATA FROM VFS_PAGES WHERE FILE_PATH = ? AND PAGE_NO = ?')) {
          const [filePath, pageNo] = bindings
          const data = mockPages.get(filePath as string)?.get(pageNo as number)
          return createMockCursor(data !== undefined ? [{ page_data: data }] as any : [] as any)
        }

        // SELECT 1 AS x FROM vfs_pages LIMIT 1
        if (normalizedQuery.includes('SELECT 1 AS X FROM VFS_PAGES')) {
          if (mockPages.size > 0) {
            return createMockCursor([{ x: 1 }] as any)
          }
          return createMockCursor([] as any)
        }

        // SELECT MAX(page_no) AS max_page FROM vfs_pages WHERE file_path = ?
        if (normalizedQuery.includes('SELECT MAX(PAGE_NO) AS MAX_PAGE FROM VFS_PAGES WHERE FILE_PATH = ?')) {
          const [filePath] = bindings
          const pages = mockPages.get(filePath as string)

          if (pages === undefined || pages.size === 0) {
            return createMockCursor([{ max_page: null }] as any)
          }

          const maxPage = Math.max(...pages.keys())
          return createMockCursor([{ max_page: maxPage }] as any)
        }

        // SELECT COUNT(*) AS total_pages, COALESCE(...) FROM vfs_pages
        if (normalizedQuery.includes('FROM VFS_PAGES') && normalizedQuery.includes('COUNT(*)')) {
          let totalBytes = 0
          let totalPages = 0

          for (const pages of mockPages.values()) {
            totalPages += pages.size

            for (const data of pages.values()) {
              totalBytes += data.length
            }
          }

          return createMockCursor([{ total_pages: totalPages, total_bytes: totalBytes }] as any)
        }

        // DELETE FROM vfs_pages WHERE file_path = ? AND page_no >= ?
        if (normalizedQuery.startsWith('DELETE FROM VFS_PAGES WHERE FILE_PATH = ? AND PAGE_NO >= ?')) {
          const [filePath, minPageNo] = bindings
          const pages = mockPages.get(filePath as string)

          if (pages !== undefined) {
            for (const pageNo of [...pages.keys()]) {
              if (pageNo >= (minPageNo as number)) {
                pages.delete(pageNo)
              }
            }

            if (pages.size === 0) {
              mockPages.delete(filePath as string)
            }
          }

          return createMockCursor([] as any)
        }

        // DELETE FROM vfs_pages WHERE file_path = ?
        if (normalizedQuery === 'DELETE FROM VFS_PAGES WHERE FILE_PATH = ?') {
          const [filePath] = bindings
          mockPages.delete(filePath as string)
          return createMockCursor([] as any)
        }

        // DELETE FROM vfs_pages (no WHERE - full wipe)
        if (normalizedQuery === 'DELETE FROM VFS_PAGES') {
          mockPages.clear()
          return createMockCursor([] as any)
        }

        console.warn('Unhandled query:', query, bindings)
        return createMockCursor([] as any)
      },

      get databaseSize(): number {
        return 1024 * 1024
      },

      Cursor: {} as any,
      Statement: {} as any,
    } as CfTypes.SqlStorage

    const createMockCursor = <T extends Record<string, CfTypes.SqlStorageValue>>(
      data: T[],
    ): CfTypes.SqlStorageCursor<T> => {
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
            yield Object.values(item)
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
      } as CfTypes.SqlStorageCursor<T>
    }

    vfs = new CloudflareDurableObjectVFS('test-sql-vfs', mockSql, {})
    await vfs.isReady()
  })

  describe('Basic File Operations', () => {
    it('should create and open files', () => {
      const path = '/test/basic.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      const result = vfs.jOpen(path, fileId, flags, pOutFlags)
      expect(result).toBe(VFS.SQLITE_OK)
      expect(pOutFlags.getUint32(0, true)).toBe(flags)
    })

    it('should delete only the opened file on close when SQLITE_OPEN_DELETEONCLOSE is set', () => {
      const pOutFlags = new DataView(new ArrayBuffer(4))

      const keepPath = '/test/keep-on-close.db'
      const keepFileId = 1
      const keepFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      vfs.jOpen(keepPath, keepFileId, keepFlags, pOutFlags)
      const keepData = makePage(0x11, 'keep-me')
      expect(vfs.jWrite(keepFileId, keepData, 0)).toBe(VFS.SQLITE_OK)

      const deletePath = '/test/delete-on-close.db'
      const deleteFileId = 2
      const deleteFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_DELETEONCLOSE
      vfs.jOpen(deletePath, deleteFileId, deleteFlags, pOutFlags)
      expect(vfs.jWrite(deleteFileId, makePage(0x22, 'delete-me'), 0)).toBe(VFS.SQLITE_OK)

      expect(vfs.jClose(deleteFileId)).toBe(VFS.SQLITE_OK)

      const readBuffer = new Uint8Array(keepData.length)
      expect(vfs.jRead(keepFileId, readBuffer, 0)).toBe(VFS.SQLITE_OK)
      expect(readBuffer).toEqual(keepData)
      expect(mockPages.has(deletePath)).toBe(false)
    })

    it('should handle basic read/write operations', () => {
      const path = '/test/readwrite.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write data
      const testData = makePage(0x33, 'Hello, SQL VFS!')
      expect(vfs.jWrite(fileId, testData, 0)).toBe(VFS.SQLITE_OK)

      // Read data back
      const readBuffer = new Uint8Array(testData.length)
      expect(vfs.jRead(fileId, readBuffer, 0)).toBe(VFS.SQLITE_OK)
      expect(readBuffer).toEqual(testData)
    })

    it('should isolate pages by file path', () => {
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      const oldPath = '/test/state-old.db'
      const oldFileId = 1
      vfs.jOpen(oldPath, oldFileId, flags, pOutFlags)

      const oldData = makePage(0x44, 'stale-state')
      expect(vfs.jWrite(oldFileId, oldData, 0)).toBe(VFS.SQLITE_OK)

      const newPath = '/test/state-new.db'
      const newFileId = 2
      vfs.jOpen(newPath, newFileId, flags, pOutFlags)

      const readBuffer = new Uint8Array(oldData.length)
      expect(vfs.jRead(newFileId, readBuffer, 0)).toBe(VFS.SQLITE_OK)
      expect(readBuffer).toEqual(new Uint8Array(oldData.length))
    })

    it('should handle file size operations', () => {
      const path = '/test/size.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Initial size should be 0
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(0n)

      // Write one full page (8 KiB) and check size
      const pageSize = PAGE_SIZE
      const testData = new Uint8Array(pageSize)
      testData.fill(0xaa)
      vfs.jWrite(fileId, testData, 0)

      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(BigInt(pageSize))
    })

    it('should handle file truncation', () => {
      const path = '/test/truncate.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      vfs.jOpen(path, fileId, flags, pOutFlags)

      // Write two full pages
      const pageSize = PAGE_SIZE
      vfs.jWrite(fileId, makePage(0xbb), 0)
      vfs.jWrite(fileId, makePage(0xcc), pageSize)

      // Truncate to one page
      expect(vfs.jTruncate(fileId, pageSize)).toBe(VFS.SQLITE_OK)

      // Verify size
      const pSize64 = new DataView(new ArrayBuffer(8))
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_OK)
      expect(pSize64.getBigInt64(0, true)).toBe(BigInt(pageSize))
    })

    it('should handle file deletion', () => {
      const path = '/test/delete.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      // Create file
      vfs.jOpen(path, fileId, flags, pOutFlags)
      const testData = makePage(0x55, 'Delete test')
      vfs.jWrite(fileId, testData, 0)

      // Delete file
      expect(vfs.jDelete(path, 0)).toBe(VFS.SQLITE_OK)

      // Verify pages are gone
      expect(mockPages.size).toBe(0)
    })

    it('should delete only the requested file path', () => {
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      const keepPath = '/test/keep.db'
      const keepFileId = 1
      vfs.jOpen(keepPath, keepFileId, flags, pOutFlags)
      const keepData = makePage(0x66, 'keep-me')
      expect(vfs.jWrite(keepFileId, keepData, 0)).toBe(VFS.SQLITE_OK)

      const deletePath = '/test/delete-only.db'
      const deleteFileId = 2
      vfs.jOpen(deletePath, deleteFileId, flags, pOutFlags)
      expect(vfs.jWrite(deleteFileId, makePage(0x77, 'delete-me'), 0)).toBe(VFS.SQLITE_OK)

      expect(vfs.jDelete(deletePath, 0)).toBe(VFS.SQLITE_OK)

      const readBuffer = new Uint8Array(keepData.length)
      expect(vfs.jRead(keepFileId, readBuffer, 0)).toBe(VFS.SQLITE_OK)
      expect(readBuffer).toEqual(keepData)
      expect(mockPages.has(deletePath)).toBe(false)
    })
  })

  describe('VFS Management', () => {
    it('should provide VFS statistics', () => {
      const stats = vfs.getStats()
      expect(stats).toHaveProperty('pageSize')
      expect(stats).toHaveProperty('totalPages')
      expect(stats).toHaveProperty('totalStoredBytes')
      expect(stats.pageSize).toBe(PAGE_SIZE)
    })
  })

  describe('Error Handling', () => {
    it('should return SQLITE_IOERR for handle-based operations on unknown file IDs', () => {
      const invalidFileId = 999
      const buffer = new Uint8Array(PAGE_SIZE)
      const pSize64 = new DataView(new ArrayBuffer(8))

      expect(vfs.jRead(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(invalidFileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jTruncate(invalidFileId, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jFileSize(invalidFileId, pSize64)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jClose(invalidFileId)).toBe(VFS.SQLITE_OK)
    })

    it('should return SQLITE_IOERR for handle-based operations after close', () => {
      const path = '/test/closed.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))
      const buffer = new Uint8Array(PAGE_SIZE)
      const pSize64 = new DataView(new ArrayBuffer(8))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      expect(vfs.jClose(fileId)).toBe(VFS.SQLITE_OK)

      expect(vfs.jRead(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jWrite(fileId, buffer, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jTruncate(fileId, 0)).toBe(VFS.SQLITE_IOERR)
      expect(vfs.jFileSize(fileId, pSize64)).toBe(VFS.SQLITE_IOERR)
    })

    it('should handle invalid paths', () => {
      const invalidPath = ''
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(invalidPath, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
    })

    it('should reject writes that do not match the configured page size', () => {
      const path = '/test/page-size-mismatch.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      expect(vfs.jWrite(fileId, new Uint8Array(PAGE_SIZE / 2), 0)).toBe(VFS.SQLITE_IOERR)
      expect(mockPages.size).toBe(0)
    })

    it('should reject writes at non-page-aligned offsets', () => {
      const path = '/test/page-offset-mismatch.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      expect(vfs.jWrite(fileId, makePage(0x88), PAGE_SIZE / 2)).toBe(VFS.SQLITE_IOERR)
      expect(mockPages.size).toBe(0)
    })

    it('should always report not found from jAccess', () => {
      const path = '/test/access.db'
      const fileId = 1
      const flags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE
      const pOutFlags = new DataView(new ArrayBuffer(4))
      const pResOut = new DataView(new ArrayBuffer(4))

      expect(vfs.jOpen(path, fileId, flags, pOutFlags)).toBe(VFS.SQLITE_OK)
      expect(vfs.jWrite(fileId, makePage(0x99, 'access-test'), 0)).toBe(VFS.SQLITE_OK)

      expect(vfs.jAccess(path, VFS.SQLITE_ACCESS_EXISTS, pResOut)).toBe(VFS.SQLITE_OK)
      expect(pResOut.getUint32(0, true)).toBe(0)
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
