# wa-sqlite Build Information

This dist directory was built with the following configuration:

## Build Environment
- **Built on:** 2026-07-09 15:36:41 UTC
- **Emscripten:** emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 5.0.7-git
- **SQLite Version:** 3.50.4
- **SQLite Commit:** 8ed5e7365e6f12f427910188bbf6b254daad2ef6

## SQLite Features Enabled
- Session extension (changesets/sync)
- Preupdate hooks
- Bytecode virtual table
- FTS5 full-text search (in fts5/ variant)

## Build Variants

### Standard Builds
- **wa-sqlite.mjs + .wasm**: Web/Worker build with all features
- **wa-sqlite-async.mjs + .wasm**: Async build for Promise-based usage
- **wa-sqlite-jspi.mjs + .wasm**: JSPI build for JavaScript Promise Integration
- **wa-sqlite.node.mjs + .wasm**: Node.js build

### FTS5 Builds
- **fts5/wa-sqlite.mjs + .wasm**: Web build with FTS5 full-text search
- **fts5/wa-sqlite.node.mjs + .wasm**: Node.js build with FTS5

## Session/Changeset API Available
The following session functions are exported and available:
- `sqlite3session_create` - Create session objects
- `sqlite3session_attach` - Attach tables to sessions
- `sqlite3session_enable` - Enable session recording
- `sqlite3session_changeset` - Generate changesets
- `sqlite3session_delete` - Clean up sessions
- `sqlite3changeset_start` - Process changesets
- `sqlite3changeset_finalize` - Finalize changeset processing
- `sqlite3changeset_invert` - Invert changesets
- `sqlite3changeset_apply` - Apply changesets

## Build Script
Generated via: `nix build .#wa-sqlite-livestore`

## File Sizes

### Standard Build Sizes
- **wa-sqlite-async.mjs**: 114K (gzip: 27.5K, brotli: 24.0K)
- **wa-sqlite-jspi.mjs**: 116K (gzip: 27.0K, brotli: 23.5K)
- **wa-sqlite.mjs**: 108K (gzip: 25.9K, brotli: 22.6K)
- **wa-sqlite.node.mjs**: 108K (gzip: 26.0K, brotli: 22.8K)
- **wa-sqlite-async.wasm**: 1.3M (gzip: 453.0K, brotli: 357.9K)
- **wa-sqlite-jspi.wasm**: 610K (gzip: 297.8K, brotli: 256.2K)
- **wa-sqlite.node.wasm**: 605K (gzip: 296.2K, brotli: 254.7K)
- **wa-sqlite.wasm**: 605K (gzip: 296.2K, brotli: 254.7K)

### FTS5 Variant Sizes
- **fts5/wa-sqlite.mjs**: 108K (gzip: 25.9K, brotli: 22.6K)
- **fts5/wa-sqlite.node.mjs**: 108K (gzip: 26.1K, brotli: 22.8K)
- **fts5/wa-sqlite.node.wasm**: 718K (gzip: 351.9K, brotli: 303.4K)
- **fts5/wa-sqlite.wasm**: 718K (gzip: 351.9K, brotli: 303.4K)

## Notes
- All builds include session extension for data synchronization
- mayCreate fixes applied to prevent filesystem errors
