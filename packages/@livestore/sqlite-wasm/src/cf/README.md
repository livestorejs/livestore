# CF SQLite WASM

## VFS SQL Schema for Cloudflare Durable Object SQL Storage

This schema implements a block-based file storage system on top of SQLite

## Schema

```sql

-- File metadata table
-- Stores information about each virtual file in the VFS
CREATE TABLE IF NOT EXISTS vfs_files (
  file_path TEXT PRIMARY KEY,
  file_size INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  modified_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Block-based file data storage
-- Files are split into fixed-size blocks for efficient I/O operations
CREATE TABLE IF NOT EXISTS vfs_blocks (
  file_path TEXT NOT NULL,
  block_id INTEGER NOT NULL,
  block_data BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (file_path, block_id),
  FOREIGN KEY (file_path) REFERENCES vfs_files(file_path) ON DELETE CASCADE
);

-- Index for efficient block range queries
-- Essential for performance when reading/writing sequential blocks
CREATE INDEX IF NOT EXISTS idx_vfs_blocks_range ON vfs_blocks(file_path, block_id);

-- Index for file metadata queries
CREATE INDEX IF NOT EXISTS idx_vfs_files_modified ON vfs_files(modified_at);

-- Trigger to update modified_at timestamp when file size changes
CREATE TRIGGER IF NOT EXISTS trg_vfs_files_update_modified 
  AFTER UPDATE OF file_size ON vfs_files
  BEGIN
    UPDATE vfs_files SET modified_at = unixepoch() WHERE file_path = NEW.file_path;
  END;

-- View for file statistics (useful for debugging and monitoring)
CREATE VIEW IF NOT EXISTS vfs_file_stats AS
SELECT 
  f.file_path,
  f.file_size,
  f.flags,
  f.created_at,
  f.modified_at,
  COUNT(b.block_id) as block_count,
  COALESCE(SUM(LENGTH(b.block_data)), 0) as stored_bytes,
  ROUND(CAST(COALESCE(SUM(LENGTH(b.block_data)), 0) AS REAL) / NULLIF(f.file_size, 0) * 100, 2) as compression_ratio
FROM vfs_files f
LEFT JOIN vfs_blocks b ON f.file_path = b.file_path
GROUP BY f.file_path, f.file_size, f.flags, f.created_at, f.modified_at;
```