import type { CfTypes } from '@livestore/common-cf'

export interface BlockRange {
  startBlock: number
  endBlock: number
  startOffset: number
  endOffset: number
}

export interface BlockData {
  blockId: number
  data: Uint8Array
}

/**
 * BlockManager handles the conversion between file operations and block-based storage
 * for the CloudflareSqlVFS. It manages fixed-size blocks stored in SQL tables.
 */
export class BlockManager {
  private readonly blockSize: number

  constructor(blockSize: number = 64 * 1024) {
    this.blockSize = blockSize
  }

  /**
   * Calculate which blocks are needed for a given file operation
   */
  calculateBlockRange(offset: number, length: number): BlockRange {
    const startBlock = Math.floor(offset / this.blockSize)
    const endBlock = Math.floor((offset + length - 1) / this.blockSize)
    const startOffset = offset % this.blockSize
    const endOffset = ((offset + length - 1) % this.blockSize) + 1

    return {
      startBlock,
      endBlock,
      startOffset,
      endOffset,
    }
  }

  /**
   * Read blocks from SQL storage and return as a Map
   */
  readBlocks(sql: CfTypes.SqlStorage, filePath: string, blockIds: number[]): Map<number, Uint8Array> {
    const blocks = new Map<number, Uint8Array>()

    if (blockIds.length === 0) {
      return blocks
    }

    // Build IN clause for efficient querying
    const placeholders = blockIds.map(() => '?').join(',')
    const query = `
      SELECT block_id, block_data 
      FROM vfs_blocks 
      WHERE file_path = ? AND block_id IN (${placeholders})
      ORDER BY block_id
    `

    const cursor = sql.exec<{ block_id: number; block_data: ArrayBuffer }>(query, filePath, ...blockIds)

    for (const row of cursor) {
      blocks.set(row.block_id, new Uint8Array(row.block_data))
    }

    return blocks
  }

  /**
   * Write blocks to SQL storage using exec for now (prepared statements later)
   */
  writeBlocks(sql: CfTypes.SqlStorage, filePath: string, blocks: Map<number, Uint8Array>): void {
    if (blocks.size === 0) {
      return
    }

    for (const [blockId, data] of blocks) {
      sql.exec(
        'INSERT OR REPLACE INTO vfs_blocks (file_path, block_id, block_data) VALUES (?, ?, ?)',
        filePath,
        blockId,
        data,
      )
    }
  }

  /**
   * Delete blocks at or after the specified block ID (used for truncation)
   */
  deleteBlocksAfter(sql: CfTypes.SqlStorage, filePath: string, startBlockId: number): void {
    sql.exec('DELETE FROM vfs_blocks WHERE file_path = ? AND block_id >= ?', filePath, startBlockId)
  }

  /**
   * Split write data into blocks, handling partial blocks at boundaries
   */
  splitIntoBlocks(
    data: Uint8Array,
    offset: number,
  ): Map<number, { blockId: number; blockOffset: number; data: Uint8Array }> {
    const blocks = new Map<number, { blockId: number; blockOffset: number; data: Uint8Array }>()

    let remainingData = data
    let currentOffset = offset

    while (remainingData.length > 0) {
      const blockId = Math.floor(currentOffset / this.blockSize)
      const blockOffset = currentOffset % this.blockSize
      const bytesToWrite = Math.min(remainingData.length, this.blockSize - blockOffset)

      const blockData = remainingData.slice(0, bytesToWrite)
      blocks.set(blockId, {
        blockId,
        blockOffset,
        data: blockData,
      })

      remainingData = remainingData.slice(bytesToWrite)
      currentOffset += bytesToWrite
    }

    return blocks
  }

  /**
   * Assemble read data from blocks into a continuous buffer
   */
  assembleBlocks(blocks: Map<number, Uint8Array>, range: BlockRange, requestedLength: number): Uint8Array {
    const result = new Uint8Array(requestedLength)
    let resultOffset = 0

    for (let blockId = range.startBlock; blockId <= range.endBlock; blockId++) {
      const blockData = blocks.get(blockId)
      if (!blockData) {
        // Block not found - fill with zeros (sparse file behavior)
        const zeroLength = Math.min(this.blockSize, requestedLength - resultOffset)
        // result is already zero-filled by default
        resultOffset += zeroLength
        continue
      }

      // Calculate the slice of this block we need
      const blockStartOffset = blockId === range.startBlock ? range.startOffset : 0
      const blockEndOffset = blockId === range.endBlock ? range.endOffset : blockData.length
      const sliceLength = blockEndOffset - blockStartOffset

      if (sliceLength > 0) {
        const slice = blockData.slice(blockStartOffset, blockEndOffset)
        result.set(slice, resultOffset)
        resultOffset += sliceLength
      }
    }

    return result
  }

  /**
   * Handle partial block writes by reading existing block, modifying, and returning complete block
   */
  mergePartialBlock(
    sql: CfTypes.SqlStorage,
    filePath: string,
    blockId: number,
    blockOffset: number,
    newData: Uint8Array,
  ): Uint8Array {
    // Read existing block data if it exists
    const existingBlocks = this.readBlocks(sql, filePath, [blockId])
    const existingBlock = existingBlocks.get(blockId) || new Uint8Array(this.blockSize)

    // Create a new block with the merged data
    const mergedBlock = new Uint8Array(this.blockSize)
    mergedBlock.set(existingBlock)
    mergedBlock.set(newData, blockOffset)

    return mergedBlock
  }

  /**
   * Get statistics about block usage for a file
   */
  getBlockStats(
    sql: CfTypes.SqlStorage,
    filePath: string,
  ): { totalBlocks: number; storedBlocks: number; totalBytes: number } {
    const blockStatsCursor = sql.exec<{ stored_blocks: number; total_bytes: number }>(
      `SELECT 
        COUNT(*) as stored_blocks,
        COALESCE(SUM(LENGTH(block_data)), 0) as total_bytes
      FROM vfs_blocks 
      WHERE file_path = ?`,
      filePath,
    )

    const result = blockStatsCursor.one()

    // Get file size to calculate theoretical total blocks
    const fileSizeCursor = sql.exec<{ file_size: number }>(
      'SELECT file_size FROM vfs_files WHERE file_path = ?',
      filePath,
    )

    let fileSize = 0
    try {
      const fileSizeResult = fileSizeCursor.one()
      fileSize = fileSizeResult.file_size
    } catch {
      // File doesn't exist
    }

    const totalBlocks = Math.ceil(fileSize / this.blockSize)

    return {
      totalBlocks,
      storedBlocks: result.stored_blocks,
      totalBytes: result.total_bytes,
    }
  }

  getBlockSize(): number {
    return this.blockSize
  }
}
