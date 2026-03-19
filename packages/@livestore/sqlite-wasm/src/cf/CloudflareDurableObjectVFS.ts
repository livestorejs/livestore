import type { CfTypes } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import { FacadeVFS } from '../FacadeVFS.ts'

// Page size for SQL-based storage. Matches dbState page size (PRAGMA page_size=8192)
// so each SQLite page write maps to exactly one vfs_pages row write — no read-merge-write.
export const PAGE_SIZE = 8 * 1024 // 8 KiB

/**
 * The {@link CloudflareDurableObjectVFS} VFS assumes SQLite is configured with these pragmas.
 * These pragmas are required both for correctness and for minimizing SQLite writes
 * to the underlying storage.
 */
export const REQUIRED_PRAGMAS = [
  // Must match the fixed VFS page size so each SQLite page maps to one vfs_pages row.
  `page_size=${PAGE_SIZE}`,
  // The rollback journal is the largest source of VFS writes. Keeping it
  // in WASM memory avoids writing journal pages through the VFS entirely.
  // This is acceptable because the state database is rebuildable from the
  // eventlog in case of a crash. We still, however, need the journal for
  // transaction rollbacks.
  'journal_mode=MEMORY',
  // Skips jSync VFS calls (already a no-op, but avoids the dispatch).
  'synchronous=OFF',
  // A Durable Object is single-threaded with a single connection, so shared
  // locking is unnecessary. Exclusive mode skips per-transaction lock/unlock
  // VFS calls and hot-journal jAccess checks.
  'locking_mode=EXCLUSIVE',
  // Temp tables and indices stay in WASM memory, preventing temp-file VFS writes.
  'temp_store=MEMORY',
  // Keeps all dirty pages in the WASM page cache until commit. Without this,
  // SQLite may spill pages to the VFS mid-transaction, and if those pages are
  // dirtied again before commit, the same page gets written twice.
  'cache_spill=OFF',
]

/**
 * wa-sqlite VFS for the LiveStore **state database** (dbState), backed by
 * {@link https://developers.cloudflare.com/durable-objects/api/sql-storage/ | SQLite in Durable Objects}.
 *
 * ## Why wa-sqlite on top of SQLite in Durable Objects
 *
 * LiveStore's state database depends on SQLite APIs that SQLite in
 * Durable Objects does not expose. This VFS persists wa-sqlite's pages as
 * rows in the DO's SQLite storage, giving the state database durable
 * persistence while retaining full access to the SQLite API.
 *
 * ## Write Optimization
 *
 * Every VFS write becomes a (billable) row write in the DO's SQLite. To
 * reduce costs, this VFS assumes a wa-sqlite configured with {@link REQUIRED_PRAGMAS}
 * for minimizing writes.
 *
 * ## File Identity
 *
 * LiveStore currently only persists the main database file through this VFS,
 * but pages still stay keyed by file path, so schema-hashed filenames open
 * isolated databases across process restarts.
 */
export class CloudflareDurableObjectVFS extends FacadeVFS {
  #sql: CfTypes.SqlStorage
  /**
   * Tracks the path and open flags for each SQLite file handle.
   *
   * @remarks
   *
   * After `jOpen`, SQLite calls the VFS with `fileId` for reads, writes,
   * truncates, size checks, and close, so we need this in-memory map to get
   * back to the persisted `file_path` key and honor handle-specific flags
   * such as `SQLITE_OPEN_DELETEONCLOSE`.
   */
  #openFiles = new Map<number, { path: string; flags: number }>()

  /**
   * @param name - VFS name registered with wa-sqlite (must be unique per database).
   * @param sql - The Durable Object's {@link CfTypes.SqlStorage} handle.
   * @param module - The wa-sqlite WASM module instance.
   */
  constructor(name: string, sql: CfTypes.SqlStorage, module: any) {
    super(name, module)
    this.#sql = sql
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS vfs_pages (
        file_path TEXT NOT NULL,
        page_no INTEGER NOT NULL,
        page_data BLOB NOT NULL,
        PRIMARY KEY (file_path, page_no)
      )`,
    )
  }

  /**
   * Accepts any open request unconditionally and records which path each fileId refers to.
   *
   * @remarks
   *
   * SQLite's fileId is only an in-memory open-handle identifier. Persisted
   * data must stay keyed by filename so schema-hashed state DB filenames
   * remain isolated from each other across restarts.
   */
  override jOpen(path: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
    const resolvedPath = this.#resolveOpenPath(path)
    this.#openFiles.set(fileId, { path: resolvedPath, flags })
    pOutFlags.setInt32(0, flags, true)
    return VFS.SQLITE_OK
  }

  override jClose(fileId: number): number {
    try {
      const openFile = this.#openFiles.get(fileId)
      if (openFile === undefined) return VFS.SQLITE_OK

      this.#openFiles.delete(fileId)

      if ((openFile.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) !== 0) {
        this.#deleteFilePages(openFile.path)
      }

      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jClose error:', error)
      return VFS.SQLITE_IOERR_CLOSE
    }
  }

  /**
   * Reads a single page from `vfs_pages` and copies the requested byte range
   * into {@link buffer}.
   *
   * @remarks
   *
   * Missing pages are zero-filled and still return `SQLITE_OK` (not `SQLITE_IOERR_SHORT_READ`)
   * because wa-sqlite expects this during initial database creation.
   */
  override jRead(fileId: number, buffer: Uint8Array, offset: number): number {
    try {
      const { path } = this.#getOpenFile(fileId)
      const pageNo = Math.floor(offset / PAGE_SIZE)
      const cursor = this.#sql.exec<{ page_data: ArrayBuffer }>(
        'SELECT page_data FROM vfs_pages WHERE file_path = ? AND page_no = ?',
        path,
        pageNo,
      )

      const rows = cursor.toArray()

      if (rows.length === 0) {
        buffer.fill(0)
        return VFS.SQLITE_OK
      }

      const src = new Uint8Array(rows[0]!.page_data)
      const pageOffset = offset % PAGE_SIZE
      const available = src.byteLength - pageOffset

      if (available >= buffer.byteLength) {
        buffer.set(src.subarray(pageOffset, pageOffset + buffer.byteLength))
        return VFS.SQLITE_OK
      }

      buffer.set(src.subarray(pageOffset))
      buffer.fill(0, available)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jRead error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  /**
   * Writes a single page to `vfs_pages`.
   *
   * @remarks
   *
   * The VFS only supports canonical SQLite page writes. Rejecting any other
   * shape turns page-size mismatches into a hard failure instead of silently
   * aliasing multiple SQLite pages onto the same `vfs_pages` row.
   *
   * The data is copied out of the WASM heap via `data.slice()` because
   * Cloudflare's SQL storage cannot persist the {@link FacadeVFS}
   * Proxy-wrapped buffer across DO restarts.
   */
  override jWrite(fileId: number, data: Uint8Array, offset: number): number {
    try {
      const { path } = this.#getOpenFile(fileId)
      this.#assertCanonicalPageWrite(data, offset)
      const pageNo = Math.floor(offset / PAGE_SIZE)
      // data.slice() copies out of the WASM heap Proxy so CF SQL storage can persist the BLOB correctly.
      this.#sql.exec(
        'INSERT OR REPLACE INTO vfs_pages (file_path, page_no, page_data) VALUES (?, ?, ?)',
        path,
        pageNo,
        data.slice(),
      )
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jWrite error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  /** Deletes all pages beyond the new file size boundary. */
  override jTruncate(fileId: number, size: number): number {
    try {
      const { path } = this.#getOpenFile(fileId)
      const lastPageNo = Math.ceil(size / PAGE_SIZE)
      this.#sql.exec('DELETE FROM vfs_pages WHERE file_path = ? AND page_no >= ?', path, lastPageNo)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jTruncate error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  /**
   * Derives file size from `MAX(page_no)`.
   *
   * @remarks
   *
   * Possible because all writes are page-aligned (page size matches `PRAGMA page_size`).
   */
  override jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const { path } = this.#getOpenFile(fileId)
      const row = this.#sql.exec<{ max_page: number | null }>(
        'SELECT MAX(page_no) AS max_page FROM vfs_pages WHERE file_path = ?',
        path,
      ).one()
      const fileSize = row.max_page === null ? 0 : (row.max_page + 1) * PAGE_SIZE
      pSize64.setBigInt64(0, BigInt(fileSize), true)
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jFileSize error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  /** Wipes all pages for the requested file path. */
  override jDelete(path: string, _syncDir: number): number {
    try {
      this.#deleteFilePages(this.#getPath(path))
      return VFS.SQLITE_OK
    } catch (error) {
      console.error('jDelete error:', error)
      return VFS.SQLITE_IOERR
    }
  }

  /** Always reports "not found".
   *
   * @remarks
   *
   * With `locking_mode=EXCLUSIVE` and `journal_mode=MEMORY`, the only `jAccess` call SQLite makes is for
   * hot-journal detection, which does not apply. Returning 1 (found) would
   * trigger hot-journal recovery writes on every cold start.
   */
  override jAccess(_path: string, _flags: number, pResOut: DataView): number {
    pResOut.setInt32(0, 0, true)
    return VFS.SQLITE_OK
  }

  /** Returns page count and total stored bytes for diagnostics. */
  getStats(): {
    pageSize: number
    totalPages: number
    totalStoredBytes: number
  } {
    try {
      const cursor = this.#sql.exec<{ total_pages: number; total_bytes: number }>(
        'SELECT COUNT(*) AS total_pages, COALESCE(SUM(LENGTH(page_data)), 0) AS total_bytes FROM vfs_pages',
      )
      const stats = cursor.one()

      return {
        pageSize: PAGE_SIZE,
        totalPages: stats.total_pages,
        totalStoredBytes: stats.total_bytes,
      }
    } catch {
      return {
        pageSize: PAGE_SIZE,
        totalPages: 0,
        totalStoredBytes: 0,
      }
    }
  }

  /**
   * Convert a bare filename, path, or URL to a UNIX-style path.
   */
  #getPath(nameOrURL: string | URL): string {
    const url = typeof nameOrURL === 'string' ? new URL(nameOrURL, 'file://localhost/') : nameOrURL
    return url.pathname
  }

  #resolveOpenPath(path: string | null): string {
    const pathOrHandleId = path !== null && path !== '' ? path : Math.random().toString(36).slice(2)
    return this.#getPath(pathOrHandleId)
  }

  #getOpenFile(fileId: number): { path: string; flags: number } {
    const openFile = this.#openFiles.get(fileId)
    if (openFile === undefined) throw new Error(`Unknown fileId ${fileId}`)
    return openFile
  }

  #assertCanonicalPageWrite(data: Uint8Array, offset: number) {
    if (offset % PAGE_SIZE !== 0) {
      throw new Error(
        `CloudflareDurableObjectVFS expected page-aligned writes, got offset=${offset} for pageSize=${PAGE_SIZE}`,
      )
    }

    if (data.byteLength !== PAGE_SIZE) {
      throw new Error(
        `CloudflareDurableObjectVFS expected single-page writes of ${PAGE_SIZE} bytes, got ${data.byteLength}. Check that SQLite PRAGMA page_size matches the VFS page size.`,
      )
    }
  }

  #deleteFilePages(path: string) {
    this.#sql.exec('DELETE FROM vfs_pages WHERE file_path = ?', path)
  }
}
