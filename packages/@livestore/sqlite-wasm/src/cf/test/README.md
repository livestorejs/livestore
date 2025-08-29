# Cloudflare SQLite WASM Test Suite

This directory contains comprehensive tests for both SQLite WASM VFS implementations on Cloudflare Workers.

## Directory Structure

### `/sql/` - SQL Storage Tests
Tests for the CloudflareSqlVFS implementation, which uses Cloudflare's DurableObject SQL API for storage.

- **`cloudflare-sql-vfs-core.test.ts`** - Core SQL VFS functionality tests

### `/async-storage/` - Async Storage Tests  
Tests for the CloudflareWorkerVFS implementation, which uses DurableObjectStorage (key-value) for file storage.

- **`cloudflare-worker-vfs-core.test.ts`** - Basic VFS operations (open, read, write, close, sync)
- **`cloudflare-worker-vfs-advanced.test.ts`** - Large file chunking and advanced features
- **`cloudflare-worker-vfs-reliability.test.ts`** - Error recovery and reliability testing
- **`cloudflare-worker-vfs-integration.test.ts`** - End-to-end integration tests

## Test Architecture

### Testing Framework
- **Vitest** with **@cloudflare/vitest-pool-workers** for Workers runtime testing
- **Isolated Storage** - Each test gets fresh storage instances
- **Real Runtime** - Tests run in the actual Cloudflare Workers runtime environment

## VFS Implementation Comparison

### SQL Storage VFS (`CloudflareSqlVFS`)
- **Backend**: Cloudflare DurableObject SQL API
- **Storage Model**: Relational tables with blocks and metadata
- **Advantages**: ACID transactions, complex queries, relational integrity
- **Use Case**: Applications requiring complex data relationships

### Async Storage VFS (`CloudflareWorkerVFS`)  
- **Backend**: DurableObjectStorage (key-value)
- **Storage Model**: 64 KiB chunks with LRU caching
- **Advantages**: Simple API, optimized for large files, better caching
- **Use Case**: High-performance file operations, large databases

## Key Design Decisions Tested

### SQL Storage Approach
- **Block-based Storage**: Files stored as blocks in SQL tables
- **Metadata Management**: File metadata in dedicated tables
- **Transaction Safety**: ACID compliance for data integrity

### Async Storage Approach
- **64 KiB Chunking Strategy**: Optimized for SQLite I/O patterns
- **Synchronous Interface with Async Backend**: Aggressive caching + background sync
- **Memory Management**: LRU cache for chunks, complete metadata cache
- **Error Handling**: SQLite-compatible error codes

## Running Tests

### Prerequisites
1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Ensure Wrangler configuration is correct:
   ```bash
   # Check wrangler.toml exists and has correct Durable Object bindings
   ```

### Test Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with UI
pnpm test:ui

# Run specific test directory
pnpm test src/cf/                         # All cf tests (SQL + async storage)
pnpm test src/cf/test/sql/                # SQL storage tests only
pnpm test src/cf/test/async-storage/      # Async storage tests only

# Run specific test file
pnpm test cloudflare-sql-vfs-core.test.ts

# Run with coverage
pnpm test --coverage
```

### Test Environment

- **Runtime**: Cloudflare Workers (via workerd)
- **Storage**: Isolated per-test storage instances

## Test Structure

### SQL Storage Test Pattern
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { type Cf, CloudflareSqlVFS } from '../../mod.ts'

describe('SQL VFS Test Suite', () => {
  let vfs: CloudflareSqlVFS
  let mockSql: Cf.SqlStorage
  let queryLog: string[]

  beforeEach(async () => {
    // Setup mock SQL storage
    mockSql = {
      exec: (query: string, ...bindings: any[]) => {
        // Mock SQL implementation
      }
    }
    
    vfs = new CloudflareSqlVFS('test-vfs', mockSql, {})
    await vfs.isReady()
  })

  // Tests...
})
```

### Async Storage Test Pattern
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { type Cf, CloudflareWorkerVFS } from '../../mod.ts'

describe('Async Storage VFS Test Suite', () => {
  let vfs: CloudflareWorkerVFS
  let mockStorage: DurableObjectStorage

  beforeEach(async () => {
    // Setup mock DurableObjectStorage
    mockStorage = {
      get: async (key) => { /* mock implementation */ },
      put: async (key, value) => { /* mock implementation */ },
      delete: async (key) => { /* mock implementation */ },
      // ... other methods
    }
    
    vfs = new CloudflareWorkerVFS('test-vfs', mockStorage, {})
    await vfs.isReady()
  })

  // Tests...
})
```

## Performance Benchmarks

### Metrics Tracked
- **Throughput**: Operations per second
- **Latency**: Response times for various operations  
- **Memory Usage**: Cache effectiveness and memory consumption
- **Storage Efficiency**: Data compression and chunking effectiveness

### Benchmark Comparisons
- SQL vs Async Storage performance characteristics
- Memory usage patterns between implementations
- Scalability under different workloads

## Test Data Cleanup

### Automatic Cleanup
- **Isolated Storage**: Each test gets fresh storage instances
- **Temporary Files**: Cleaned up automatically
- **Cache Management**: Memory caches cleared between tests

## Debugging Tests

### Logging
- Use `console.log` for debugging (visible in test output)
- VFS statistics available via `vfs.getStats()`
- Storage operations logged in development mode

### Common Issues
1. **SQL Schema Issues**: Ensure proper table creation and constraints
2. **Cache Misses**: Verify proper preloading in VFS initialization
3. **Async/Sync Mismatch**: Check async operations are properly handled
4. **Storage Limits**: Verify chunk sizes and storage capacity

### Test Debugging
```typescript
// SQL VFS debugging
console.log('Query log:', queryLog)
const stats = vfs.getStats()
console.log('VFS Stats:', stats)

// Async Storage VFS debugging  
const metadata = await storage.get('file:/test/file.db:meta')
console.log('File metadata:', metadata)
```

## Future Enhancements

### Planned Test Additions
1. **Performance Comparisons**: Direct SQL vs Async Storage benchmarks
2. **Migration Tests**: Converting between storage backends
3. **Stress Tests**: High-load scenarios for both implementations
4. **Real SQLite Integration**: Tests with actual SQLite WASM

### Implementation Improvements
1. **Hybrid Approach**: Combining SQL and async storage benefits
2. **Compression Testing**: Data compression effectiveness
3. **Caching Strategies**: Cross-implementation cache optimization

## Contributing

When adding new tests:
1. Choose the appropriate location:
   - SQL storage tests: `/src/cf/test/sql/`
   - Async storage tests: `/src/cf/test/async-storage/`
2. Follow the existing test structure for that implementation
3. Use descriptive test names indicating the VFS type
4. Include both positive and negative test cases
5. Update this documentation

### Test Guidelines
- **Isolation**: Each test should be independent
- **Implementation Specific**: Tests should target specific VFS features
- **Assertions**: Use meaningful assertions with clear error messages
- **Coverage**: Aim for comprehensive coverage of edge cases
- **Performance**: Consider performance implications of each approach