/// <reference types="node" />

import * as fs from 'node:fs'
import path from 'node:path'

import type * as WaSqlite from '@livestore/wa-sqlite'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

import { FacadeVFS } from '../FacadeVFS.ts'

interface NodeFsFile {
  pathname: string
  flags: number
  fileHandle: number | null
}

export class NodeFS extends FacadeVFS {
  private mapIdToFile = new Map<number, NodeFsFile>()
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for debugging
  private lastError: Error | null = null
  private readonly directory: string
  private readonly onShutdown: () => void
  constructor(name: string, sqlite3: WaSqlite.SQLiteAPI, directory: string, onShutdown: () => void) {
    super(name, sqlite3)

    this.directory = directory
    this.onShutdown = onShutdown
  }

  getFilename(fileId: number): string {
    const pathname = this.mapIdToFile.get(fileId)?.pathname
    return `NodeFS:${pathname}`
  }

  jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      const pathname = zName ? path.resolve(this.directory, zName) : Math.random().toString(36).slice(2)
      const file: NodeFsFile = { pathname, flags, fileHandle: null }
      this.mapIdToFile.set(fileId, file)

      const create = !!(flags & VFS.SQLITE_OPEN_CREATE)
      const readwrite = !!(flags & VFS.SQLITE_OPEN_READWRITE)

      // Convert SQLite flags to Node.js flags
      let fsFlags = 'r'
      if (create && readwrite) {
        // Check if file exists first
        const exists = fs.existsSync(pathname)
        fsFlags = exists ? 'r+' : 'w+' // Use r+ for existing files, w+ only for new files
      } else if (readwrite) {
        fsFlags = 'r+' // Open file for reading and writing
      }

      try {
        file.fileHandle = fs.openSync(pathname, fsFlags)
        pOutFlags.setInt32(0, flags, true)
        return VFS.SQLITE_OK
      } catch (err: any) {
        if (err.code === 'ENOENT' && !create) {
          return VFS.SQLITE_CANTOPEN
        }
        throw err
      }
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_CANTOPEN
    }
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const file = this.mapIdToFile.get(fileId)
      if (!file?.fileHandle) return VFS.SQLITE_IOERR_READ

      // const view = new DataView(pData.buffer, pData.byteOffset, pData.length)
      // const bytesRead = fs.readSync(file.fileHandle, view, 0, pData.length, iOffset)
      const bytesRead = fs.readSync(file.fileHandle, pData.subarray(), { position: iOffset })

      if (bytesRead < pData.length) {
        pData.fill(0, bytesRead)
        return VFS.SQLITE_IOERR_SHORT_READ
      }
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_READ
    }
  }

  jWrite(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const file = this.mapIdToFile.get(fileId)
      if (!file?.fileHandle) return VFS.SQLITE_IOERR_WRITE

      // const view = new DataView(pData.buffer, pData.byteOffset, pData.length)
      // fs.writeSync(file.fileHandle, view, 0, pData.length, iOffset)
      fs.writeSync(file.fileHandle, Buffer.from(pData.subarray()), 0, pData.length, iOffset)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_WRITE
    }
  }

  jClose(fileId: number): number {
    try {
      this.onShutdown()

      const file = this.mapIdToFile.get(fileId)
      if (!file) return VFS.SQLITE_OK

      this.mapIdToFile.delete(fileId)
      if (file.fileHandle !== null) {
        fs.closeSync(file.fileHandle)
      }

      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        fs.unlinkSync(file.pathname)
      }
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_CLOSE
    }
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const file = this.mapIdToFile.get(fileId)
      if (!file?.fileHandle) return VFS.SQLITE_IOERR_FSTAT

      const stats = fs.fstatSync(file.fileHandle)
      pSize64.setBigInt64(0, BigInt(stats.size), true)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_FSTAT
    }
  }

  jTruncate(fileId: number, iSize: number): number {
    try {
      const file = this.mapIdToFile.get(fileId)
      if (!file?.fileHandle) return VFS.SQLITE_IOERR_TRUNCATE

      fs.ftruncateSync(file.fileHandle, iSize)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_TRUNCATE
    }
  }

  jSync(fileId: number, _flags: number): number {
    try {
      const file = this.mapIdToFile.get(fileId)
      if (!file?.fileHandle) return VFS.SQLITE_OK

      // TODO do this out of band (for now we disable it to speed up the node vfs)
      // fs.fsyncSync(file.fileHandle)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_FSYNC
    }
  }

  jDelete(zName: string, _syncDir: number): number {
    try {
      this.onShutdown()

      const pathname = path.resolve(this.directory, zName)
      fs.unlinkSync(pathname)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_DELETE
    }
  }

  jAccess(zName: string, _flags: number, pResOut: DataView): number {
    try {
      const pathname = path.resolve(this.directory, zName)
      const exists = fs.existsSync(pathname)
      pResOut.setInt32(0, exists ? 1 : 0, true)
      return VFS.SQLITE_OK
    } catch (e: any) {
      this.lastError = e
      return VFS.SQLITE_IOERR_ACCESS
    }
  }

  deleteDb(fileName: string) {
    this.onShutdown()

    fs.unlinkSync(path.join(this.directory, fileName))
  }
}
