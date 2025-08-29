import type { CfTypes } from '@livestore/common-cf'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'
import { FacadeVFS } from '../FacadeVFS.ts'

const SECTOR_SIZE = 4096

// Chunk size optimized for SQLite I/O patterns
// 64 KiB provides good balance between memory usage and I/O efficiency
// while staying well under DurableObjectStorage's 128 KiB limit
const CHUNK_SIZE = 64 * 1024 // 64 KiB

// Cache configuration for synchronous operations
const DEFAULT_CACHE_SIZE = 10 // Number of chunks to cache
const DEFAULT_MAX_FILES = 100 // Maximum number of files

// These file types are expected to persist in the file system outside
// a session. Other files will be removed on VFS start.
const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_SUPER_JOURNAL | VFS.SQLITE_OPEN_WAL

interface FileMetadata {
  size: number
  flags: number
  chunkCount: number
  created: number
}

interface CacheEntry {
  data: Uint8Array
  lastAccessed: number
}

interface FileHandle {
  path: string
  flags: number
  metadata: FileMetadata
}

/**
 * VFS implementation using Cloudflare DurableObjectStorage as the backend.
 * Uses chunked storage with in-memory caching for synchronous operations.
 *
 * Storage Strategy:
 * - Files are split into 64 KiB chunks for optimal SQLite I/O patterns
 * - Metadata cached in memory for synchronous access
 * - LRU cache for frequently accessed chunks
 *
 * Key Schema:
 * - file:${path}:meta - File metadata (size, flags, chunkCount, created)
 * - file:${path}:${chunkIndex} - File data chunks (64 KiB max)
 * - index:files - Set of active file paths
 */
export class CloudflareWorkerVFS extends FacadeVFS {
  log = null

  #storage: CfTypes.DurableObjectStorage
  #initialized = false

  // In-memory caches for synchronous operations
  #metadataCache = new Map<string, FileMetadata>()
  #chunkCache = new Map<string, CacheEntry>()
  #activeFiles = new Set<string>()
  #openFiles = new Map<number, FileHandle>()

  // Configuration
  #maxCacheSize: number
  #maxFiles: number

  static async create(name: string, storage: CfTypes.DurableObjectStorage, module: any) {
    const vfs = new CloudflareWorkerVFS(name, storage, module)
    await vfs.isReady()
    return vfs
  }

  constructor(name: string, storage: CfTypes.DurableObjectStorage, module: any) {
    super(name, module)
    this.#storage = storage
    this.#maxCacheSize = DEFAULT_CACHE_SIZE
    this.#maxFiles = DEFAULT_MAX_FILES
  }

  // Storage key generation helpers
  #getMetadataKey(path: string): string {
    return `file:${path}:meta`
  }

  #getChunkKey(path: string, chunkIndex: number): string {
    return `file:${path}:${chunkIndex}`
  }

  #getCacheKey(path: string, chunkIndex: number): string {
    return `${path}:${chunkIndex}`
  }

  // Cache management
  #evictLRUChunk() {
    if (this.#chunkCache.size < this.#maxCacheSize) return

    let oldestKey = ''
    let oldestTime = Date.now()

    for (const [key, entry] of this.#chunkCache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.#chunkCache.delete(oldestKey)
    }
  }

  #getCachedChunk(path: string, chunkIndex: number): Uint8Array | undefined {
    const key = this.#getCacheKey(path, chunkIndex)
    const entry = this.#chunkCache.get(key)
    if (entry) {
      entry.lastAccessed = Date.now()
      return entry.data
    }
    return undefined
  }

  #setCachedChunk(path: string, chunkIndex: number, data: Uint8Array) {
    this.#evictLRUChunk()
    const key = this.#getCacheKey(path, chunkIndex)
    this.#chunkCache.set(key, {
      data: data.slice(), // Copy the data
      lastAccessed: Date.now(),
    })
  }

  // Critical: Handle synchronous operations with async backend
  // Strategy: Use aggressive caching + background sync for durability
  // All reads must be served from cache, writes are cached immediately
  // and synced to storage asynchronously

  #pendingWrites = new Set<string>()
  #writePromises = new Map<string, Promise<unknown>>()

  #scheduleWrite(path: string, operation: () => Promise<unknown>): void {
    const key = `write:${path}`

    // Cancel any pending write for this path
    if (this.#writePromises.has(key)) {
      this.#pendingWrites.delete(key)
    }

    // Schedule new write
    this.#pendingWrites.add(key)
    const promise = operation().finally(() => {
      this.#pendingWrites.delete(key)
      this.#writePromises.delete(key)
    })

    this.#writePromises.set(key, promise)
  }

  async #flushPendingWrites(): Promise<void> {
    const promises = Array.from(this.#writePromises.values())
    await Promise.all(promises)
  }

  async #loadMetadata(path: string): Promise<FileMetadata | undefined> {
    const cached = this.#metadataCache.get(path)
    if (cached) return cached

    const metadata = await this.#storage.get<FileMetadata>(this.#getMetadataKey(path))
    if (metadata) {
      this.#metadataCache.set(path, metadata)
    }
    return metadata
  }

  async #saveMetadata(path: string, metadata: FileMetadata): Promise<void> {
    // TODO: Consider allowUnconfirmed: true for better performance
    // Currently using strict consistency as requested
    // Future optimization: explore allowUnconfirmed for non-critical writes
    await this.#storage.put(this.#getMetadataKey(path), metadata)
    this.#metadataCache.set(path, metadata)
  }

  async #loadChunk(path: string, chunkIndex: number): Promise<Uint8Array | undefined> {
    const cached = this.#getCachedChunk(path, chunkIndex)
    if (cached) return cached

    const chunk = await this.#storage.get<Uint8Array>(this.#getChunkKey(path, chunkIndex))
    if (chunk) {
      this.#setCachedChunk(path, chunkIndex, chunk)
    }
    return chunk
  }

  async #saveChunk(path: string, chunkIndex: number, data: Uint8Array): Promise<void> {
    await this.#storage.put(this.#getChunkKey(path, chunkIndex), data)
    this.#setCachedChunk(path, chunkIndex, data)
  }

  async #deleteFile(path: string): Promise<void> {
    const metadata = await this.#loadMetadata(path)
    if (!metadata) return

    // Delete all chunks and metadata atomically
    const keysToDelete = [this.#getMetadataKey(path)]
    for (let i = 0; i < metadata.chunkCount; i++) {
      keysToDelete.push(this.#getChunkKey(path, i))
    }

    await this.#storage.delete(keysToDelete)

    // Clean up caches
    this.#metadataCache.delete(path)
    for (let i = 0; i < metadata.chunkCount; i++) {
      this.#chunkCache.delete(this.#getCacheKey(path, i))
    }

    this.#activeFiles.delete(path)

    // Update the file index
    await this.#updateFileIndex()
  }

  jOpen(zName: string, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      const path = zName ? this.#getPath(zName) : Math.random().toString(36)
      const metadata = this.#metadataCache.get(path)

      if (!metadata && flags & VFS.SQLITE_OPEN_CREATE) {
        // Create new file
        if (this.#activeFiles.size >= this.#maxFiles) {
          throw new Error('cannot create file: capacity exceeded')
        }

        const newMetadata: FileMetadata = {
          size: 0,
          flags,
          chunkCount: 0,
          created: Date.now(),
        }

        // Cache the metadata immediately for synchronous access
        this.#metadataCache.set(path, newMetadata)
        this.#activeFiles.add(path)

        // Schedule async save to maintain durability
        this.#scheduleWrite(path, () => this.#saveMetadata(path, newMetadata))
      }

      if (!this.#metadataCache.has(path)) {
        throw new Error('file not found')
      }

      const handle: FileHandle = {
        path,
        flags,
        metadata: this.#metadataCache.get(path)!,
      }

      this.#openFiles.set(fileId, handle)
      pOutFlags.setInt32(0, flags, true)
      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error(e.message)
      return VFS.SQLITE_CANTOPEN
    }
  }

  jClose(fileId: number): number {
    const handle = this.#openFiles.get(fileId)
    if (handle) {
      this.#openFiles.delete(fileId)
      if (handle.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        // Schedule async delete
        this.#scheduleWrite(handle.path, () => this.#deleteFile(handle.path))
      }
    }
    return VFS.SQLITE_OK
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) return VFS.SQLITE_IOERR

      const fileSize = handle.metadata.size
      const requestedBytes = pData.byteLength

      // Zero-length reads should always succeed
      if (requestedBytes === 0) {
        return VFS.SQLITE_OK
      }

      if (iOffset >= fileSize) {
        pData.fill(0)
        return VFS.SQLITE_IOERR_SHORT_READ
      }

      const bytesToRead = Math.min(requestedBytes, fileSize - iOffset)
      const startChunk = Math.floor(iOffset / CHUNK_SIZE)
      const endChunk = Math.floor((iOffset + bytesToRead - 1) / CHUNK_SIZE)

      let bytesRead = 0

      for (let chunkIndex = startChunk; chunkIndex <= endChunk; chunkIndex++) {
        const chunk = this.#getCachedChunk(handle.path, chunkIndex)
        if (!chunk) {
          // Cache miss - this is a problem for synchronous operation
          // We should have preloaded chunks during initialization
          console.warn(`Cache miss for chunk ${chunkIndex} of ${handle.path}`)

          // Emergency: try to preload the chunk for future reads
          this.#preloadChunks(handle.path, chunkIndex, 1).catch(console.error)

          pData.fill(0, bytesRead)
          return VFS.SQLITE_IOERR_SHORT_READ
        }

        const chunkOffset = chunkIndex * CHUNK_SIZE
        const readStart = Math.max(0, iOffset - chunkOffset)
        const readEnd = Math.min(chunk.length, iOffset + requestedBytes - chunkOffset)
        const chunkBytesToRead = readEnd - readStart

        if (chunkBytesToRead > 0) {
          pData.set(chunk.subarray(readStart, readEnd), bytesRead)
          bytesRead += chunkBytesToRead
        }
      }

      if (bytesRead < requestedBytes) {
        pData.fill(0, bytesRead, requestedBytes)
        return VFS.SQLITE_IOERR_SHORT_READ
      }

      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jRead error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jWrite(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) return VFS.SQLITE_IOERR

      const bytesToWrite = pData.byteLength
      const startChunk = Math.floor(iOffset / CHUNK_SIZE)
      const endChunk = Math.floor((iOffset + bytesToWrite - 1) / CHUNK_SIZE)

      let bytesWritten = 0
      const chunksToSave: Array<{ chunkIndex: number; data: Uint8Array }> = []

      for (let chunkIndex = startChunk; chunkIndex <= endChunk; chunkIndex++) {
        const chunkOffset = chunkIndex * CHUNK_SIZE
        const writeStart = Math.max(0, iOffset - chunkOffset)
        const writeEnd = Math.min(CHUNK_SIZE, iOffset + bytesToWrite - chunkOffset)

        let chunk = this.#getCachedChunk(handle.path, chunkIndex)
        if (!chunk) {
          // Create new chunk
          chunk = new Uint8Array(CHUNK_SIZE)
        } else {
          // Copy existing chunk for modification
          chunk = chunk.slice()
        }

        const chunkBytesToWrite = writeEnd - writeStart
        if (chunkBytesToWrite > 0) {
          const dataOffset = bytesWritten
          chunk.set(pData.subarray(dataOffset, dataOffset + chunkBytesToWrite), writeStart)
          bytesWritten += chunkBytesToWrite

          chunksToSave.push({ chunkIndex, data: chunk })
        }
      }

      // Update metadata
      const newSize = Math.max(handle.metadata.size, iOffset + bytesToWrite)
      const newChunkCount = Math.ceil(newSize / CHUNK_SIZE)

      handle.metadata.size = newSize
      handle.metadata.chunkCount = newChunkCount

      // Cache the modified chunks immediately
      for (const { chunkIndex, data } of chunksToSave) {
        this.#setCachedChunk(handle.path, chunkIndex, data)
      }

      // Schedule async saves to maintain durability
      this.#scheduleWrite(handle.path, async () => {
        await this.#saveMetadata(handle.path, handle.metadata)
        await Promise.all(chunksToSave.map(({ chunkIndex, data }) => this.#saveChunk(handle.path, chunkIndex, data)))
      })

      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jWrite error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jTruncate(fileId: number, iSize: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) return VFS.SQLITE_IOERR

      // const oldSize = handle.metadata.size
      const newChunkCount = Math.ceil(iSize / CHUNK_SIZE)
      const oldChunkCount = handle.metadata.chunkCount

      handle.metadata.size = iSize
      handle.metadata.chunkCount = newChunkCount

      // If truncating to smaller size, remove excess chunks
      if (newChunkCount < oldChunkCount) {
        const chunksToDelete: string[] = []
        for (let i = newChunkCount; i < oldChunkCount; i++) {
          const cacheKey = this.#getCacheKey(handle.path, i)
          this.#chunkCache.delete(cacheKey)
          chunksToDelete.push(this.#getChunkKey(handle.path, i))
        }

        // Schedule async delete of excess chunks
        if (chunksToDelete.length > 0) {
          this.#scheduleWrite(handle.path, async () => {
            await this.#storage.delete(chunksToDelete)
          })
        }
      }

      // If the last chunk needs to be truncated, update it
      if (newChunkCount > 0) {
        const lastChunkIndex = newChunkCount - 1
        const lastChunkSize = iSize - lastChunkIndex * CHUNK_SIZE

        if (lastChunkSize < CHUNK_SIZE) {
          const lastChunk = this.#getCachedChunk(handle.path, lastChunkIndex)
          if (lastChunk) {
            const truncatedChunk = new Uint8Array(CHUNK_SIZE)
            truncatedChunk.set(lastChunk.subarray(0, lastChunkSize))
            this.#setCachedChunk(handle.path, lastChunkIndex, truncatedChunk)
            this.#scheduleWrite(handle.path, () => this.#saveChunk(handle.path, lastChunkIndex, truncatedChunk))
          }
        }
      }

      // Schedule async metadata update
      this.#scheduleWrite(handle.path, () => this.#saveMetadata(handle.path, handle.metadata))

      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jTruncate error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jSync(fileId: number, _flags: number): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) return VFS.SQLITE_IOERR

      // Force sync all pending writes for this file
      // Note: DurableObjectStorage operations are already synchronous
      // and atomic, so this is mostly a no-op
      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jSync error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const handle = this.#openFiles.get(fileId)
      if (!handle) return VFS.SQLITE_IOERR

      pSize64.setBigInt64(0, BigInt(handle.metadata.size), true)
      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jFileSize error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jSectorSize(_fileId: number): number {
    return SECTOR_SIZE
  }

  jDeviceCharacteristics(_fileId: number): number {
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN
  }

  jAccess(zName: string, _flags: number, pResOut: DataView): number {
    try {
      const path = this.#getPath(zName)
      const exists = this.#activeFiles.has(path)
      pResOut.setInt32(0, exists ? 1 : 0, true)
      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jAccess error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  jDelete(zName: string, _syncDir: number): number {
    try {
      const path = this.#getPath(zName)

      // Schedule async delete
      this.#scheduleWrite(path, () => this.#deleteFile(path))

      return VFS.SQLITE_OK
    } catch (e: any) {
      console.error('jDelete error:', e.message)
      return VFS.SQLITE_IOERR
    }
  }

  async close() {
    // Clear all caches
    this.#metadataCache.clear()
    this.#chunkCache.clear()
    this.#activeFiles.clear()
    this.#openFiles.clear()
    this.#initialized = false
  }

  async isReady() {
    if (!this.#initialized) {
      await this.#initializeStorage()
      this.#initialized = true
    }
    return true
  }

  async #initializeStorage() {
    // Load list of existing files
    const fileList = await this.#storage.get<string[]>('index:files')
    if (fileList) {
      for (const path of fileList) {
        this.#activeFiles.add(path)
        // Preload metadata for all files
        await this.#loadMetadata(path)
        // Preload first chunk of each file for better performance
        await this.#loadChunk(path, 0)
      }
    }

    // Clean up temporary files that shouldn't persist
    await this.#cleanupTemporaryFiles()

    // Update the file index to reflect any cleanup
    await this.#updateFileIndex()
  }

  async #cleanupTemporaryFiles() {
    for (const path of this.#activeFiles) {
      const metadata = this.#metadataCache.get(path)
      if (
        metadata &&
        (metadata.flags & VFS.SQLITE_OPEN_DELETEONCLOSE || (metadata.flags & PERSISTENT_FILE_TYPES) === 0)
      ) {
        console.warn(`Cleaning up temporary file: ${path}`)
        await this.#deleteFile(path)
      }
    }
  }

  /**
   * Returns the number of SQLite files in the file system.
   */
  getSize(): number {
    return this.#activeFiles.size
  }

  /**
   * Returns the maximum number of SQLite files the file system can hold.
   */
  getCapacity(): number {
    return this.#maxFiles
  }

  /**
   * Increase the capacity of the file system by n.
   */
  async addCapacity(n: number): Promise<number> {
    this.#maxFiles += n
    return n
  }

  /**
   * Decrease the capacity of the file system by n. The capacity cannot be
   * decreased to fewer than the current number of SQLite files in the
   * file system.
   */
  async removeCapacity(n: number): Promise<number> {
    const currentSize = this.getSize()
    const currentCapacity = this.getCapacity()
    const newCapacity = Math.max(currentSize, currentCapacity - n)
    const actualReduction = currentCapacity - newCapacity

    this.#maxFiles = newCapacity
    return actualReduction
  }

  async #updateFileIndex() {
    // Update the persistent file index
    const fileList = Array.from(this.#activeFiles)
    await this.#storage.put('index:files', fileList)
  }

  /**
   * Preload chunks for a file to support synchronous reads.
   * SQLite typically reads files sequentially, so we preload nearby chunks.
   */
  async #preloadChunks(path: string, startChunk: number, count = 3) {
    const metadata = this.#metadataCache.get(path)
    if (!metadata) return

    const endChunk = Math.min(startChunk + count, metadata.chunkCount)
    const promises: Promise<void>[] = []

    for (let i = startChunk; i < endChunk; i++) {
      if (!this.#getCachedChunk(path, i)) {
        promises.push(this.#loadChunk(path, i).then(() => {}))
      }
    }

    await Promise.all(promises)
  }

  /**
   * Flush all pending writes and sync to storage.
   * This is useful for ensuring durability before critical operations.
   */
  async syncToStorage(): Promise<void> {
    await this.#flushPendingWrites()
    await this.#storage.sync()
  }

  /**
   * Get statistics about the VFS for debugging and monitoring.
   */
  getStats() {
    return {
      activeFiles: this.#activeFiles.size,
      openFiles: this.#openFiles.size,
      cachedChunks: this.#chunkCache.size,
      cachedMetadata: this.#metadataCache.size,
      pendingWrites: this.#pendingWrites.size,
      maxFiles: this.#maxFiles,
      maxCacheSize: this.#maxCacheSize,
      chunkSize: CHUNK_SIZE,
    }
  }

  /**
   * Convert a bare filename, path, or URL to a UNIX-style path.
   */
  #getPath(nameOrURL: string | URL): string {
    const url = typeof nameOrURL === 'string' ? new URL(nameOrURL, 'file://localhost/') : nameOrURL
    return url.pathname
  }
}
