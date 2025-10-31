# File Sync System Design Plan

## Project Overview

A bidirectional file synchronization CLI tool built with LiveStore and Effect that keeps two folders in sync. The system uses LiveStore's event sourcing to track file changes, handle conflicts gracefully, and support both one-time sync and continuous monitoring modes.

## Core Features

- **Bidirectional sync**: Changes in either folder sync to the other
- **One-time or continuous**: Support both `sync` and `watch` modes
- **Conflict resolution**: Graceful handling of concurrent modifications
- **User vs app change detection**: Differentiate user changes from sync operations
- **Full audit trail**: Event sourcing provides complete change history
- **Type-safe**: Built with Effect for comprehensive error handling

## CLI Usage

```bash
# One-time bidirectional sync
file-sync sync /path/to/dir-a /path/to/dir-b

# Continuous watching mode (runs until interrupted)
file-sync watch /path/to/dir-a /path/to/dir-b

# View sync status and conflicts
file-sync status
file-sync conflicts list

# Resolve conflicts interactively or automatically
file-sync conflicts resolve <file-id> --strategy=keep-newest
file-sync conflicts resolve <file-id> --strategy=keep-largest  
file-sync conflicts resolve <file-id> --strategy=keep-a
file-sync conflicts resolve <file-id> --strategy=keep-b
file-sync conflicts resolve <file-id> --interactive
```

## Architecture

### Event Sourcing Design

The system uses LiveStore's event sourcing where:
- **Events capture all file system changes** (create, modify, delete, move)
- **Materializers transform events to queryable state** in SQLite tables
- **Sync operations are also events** for full traceability
- **Conflicts are detected and resolved through events**

### Core Services

```typescript
// File watching and change detection
FileWatcherService
  ├── Monitors filesystem changes using chokidar
  ├── Calculates content hashes for conflict detection
  ├── Batches rapid changes to avoid event storms
  └── Transforms filesystem events to LiveStore events

// Bidirectional sync orchestration  
SyncEngineService
  ├── Processes sync events and performs file operations
  ├── Handles conflict detection during sync operations
  ├── Manages sync batching and error recovery
  └── Tracks sync intent vs completion for change attribution

// Conflict detection and resolution
ConflictResolverService
  ├── Implements multiple resolution strategies
  ├── Interactive prompts for user decisions
  ├── Automatic resolution based on configurable rules
  └── Maintains conflict audit trail
```

## Event Schema Design

### File Lifecycle Events

```typescript
export const events = {
  fileDetected: Events.synced({
    name: 'v1.FileDetected',
    schema: Schema.Struct({
      id: Schema.String,           // Relative path from sync root
      path: Schema.String,         // Full absolute path
      size: Schema.Number,
      mtime: Schema.DateFromNumber, // File modification time
      hash: Schema.String,         // Content hash (SHA-256)
      sourceDir: Schema.Literal('a', 'b'), // Which directory detected it
      detectedAt: Schema.DateFromNumber,   // When we detected it
    }),
  }),
  
  fileModified: Events.synced({
    name: 'v1.FileModified', 
    schema: Schema.Struct({
      id: Schema.String,
      newHash: Schema.String,      // New content hash
      newMtime: Schema.DateFromNumber,
      newSize: Schema.Number,
      sourceDir: Schema.Literal('a', 'b'),
      modifiedAt: Schema.DateFromNumber,
    }),
  }),
  
  fileDeleted: Events.synced({
    name: 'v1.FileDeleted',
    schema: Schema.Struct({
      id: Schema.String,
      sourceDir: Schema.Literal('a', 'b'),
      deletedAt: Schema.DateFromNumber,
    }),
  }),
  
  fileMoved: Events.synced({
    name: 'v1.FileMoved',
    schema: Schema.Struct({
      oldId: Schema.String,        // Old relative path
      newId: Schema.String,        // New relative path
      sourceDir: Schema.Literal('a', 'b'),
      movedAt: Schema.DateFromNumber,
    }),
  }),
}
```

### Sync Operation Events

```typescript
export const syncEvents = {
  syncIntent: Events.synced({
    name: 'v1.SyncIntent',
    schema: Schema.Struct({
      id: Schema.String,           // File being synced
      fromDir: Schema.Literal('a', 'b'),
      toDir: Schema.Literal('a', 'b'), 
      syncType: Schema.Literal('copy', 'delete', 'move'),
      intentAt: Schema.DateFromNumber,
    }),
  }),
  
  syncCompleted: Events.synced({
    name: 'v1.SyncCompleted',
    schema: Schema.Struct({
      id: Schema.String,
      fromDir: Schema.Literal('a', 'b'),
      toDir: Schema.Literal('a', 'b'),
      syncType: Schema.Literal('copy', 'delete', 'move'),
      completedAt: Schema.DateFromNumber,
    }),
  }),
  
  syncFailed: Events.synced({
    name: 'v1.SyncFailed',
    schema: Schema.Struct({
      id: Schema.String,
      fromDir: Schema.Literal('a', 'b'),
      toDir: Schema.Literal('a', 'b'),
      error: Schema.String,
      failedAt: Schema.DateFromNumber,
    }),
  }),
}
```

### Conflict Handling Events

```typescript
export const conflictEvents = {
  conflictDetected: Events.synced({
    name: 'v1.ConflictDetected',
    schema: Schema.Struct({
      id: Schema.String,           // File with conflict
      hashA: Schema.String,        // Content hash in dir A
      hashB: Schema.String,        // Content hash in dir B  
      mtimeA: Schema.DateFromNumber, // Modification time in dir A
      mtimeB: Schema.DateFromNumber, // Modification time in dir B
      conflictType: Schema.Literal(
        'modify-modify',   // Both directories modified the file
        'modify-delete',   // One modified, other deleted
        'create-create'    // Same file created in both directories
      ),
      detectedAt: Schema.DateFromNumber,
    }),
  }),
  
  conflictResolved: Events.synced({
    name: 'v1.ConflictResolved',
    schema: Schema.Struct({
      id: Schema.String,
      resolution: Schema.Literal(
        'keep-a',      // Keep version from directory A
        'keep-b',      // Keep version from directory B
        'skip',        // Don't sync this file
        'merge'        // Manual merge (future enhancement)
      ),
      resolvedAt: Schema.DateFromNumber,
      resolvedBy: Schema.Literal(
        'user',           // Manual user decision
        'auto-newest',    // Automatic: keep newest file
        'auto-largest',   // Automatic: keep largest file
        'auto-first'      // Automatic: keep first detected
      ),
    }),
  }),
}
```

## SQLite State Schema

### Files Table

Tracks the current state of all files in both directories:

```typescript
export const files = State.SQLite.table({
  name: 'files',
  columns: {
    id: State.SQLite.text({ primaryKey: true }), // Relative path
    pathA: State.SQLite.text({ nullable: true }), // Full path in directory A  
    pathB: State.SQLite.text({ nullable: true }), // Full path in directory B
    size: State.SQLite.integer(),                // File size in bytes
    mtime: State.SQLite.integer({ schema: Schema.DateFromNumber }), // Last modification time
    hash: State.SQLite.text(),                   // Current content hash
    presentInA: State.SQLite.integer({ schema: Schema.Boolean }), // Exists in dir A
    presentInB: State.SQLite.integer({ schema: Schema.Boolean }), // Exists in dir B
    conflictState: State.SQLite.text({ nullable: true }), // 'conflict' | null
    lastSyncedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    modifiedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
  },
  indexes: [
    { name: 'files_mtime', columns: ['mtime'] },
    { name: 'files_conflict', columns: ['conflictState'] },
    { name: 'files_synced', columns: ['lastSyncedAt'] },
    { name: 'files_present_a', columns: ['presentInA'] },
    { name: 'files_present_b', columns: ['presentInB'] },
  ],
})
```

### Conflicts Table

Tracks all conflicts and their resolutions:

```typescript
export const conflicts = State.SQLite.table({
  name: 'conflicts',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),    // Unique conflict ID
    fileId: State.SQLite.text(),                    // File that has the conflict
    conflictType: State.SQLite.text(),              // Type of conflict
    hashA: State.SQLite.text({ nullable: true }),   // Hash in directory A
    hashB: State.SQLite.text({ nullable: true }),   // Hash in directory B
    mtimeA: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    mtimeB: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    resolution: State.SQLite.text({ nullable: true }), // How it was resolved
    resolvedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    resolvedBy: State.SQLite.text({ nullable: true }), // Who/what resolved it
    detectedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
  },
  indexes: [
    { name: 'conflicts_file', columns: ['fileId'] },
    { name: 'conflicts_resolved', columns: ['resolvedAt'] },
  ],
})
```

### Sync State (Client Document)

Local-only state for the sync session:

```typescript
export const syncState = State.SQLite.clientDocument({
  name: 'syncState',
  schema: Schema.Struct({ 
    dirA: Schema.String,                    // Path to directory A
    dirB: Schema.String,                    // Path to directory B  
    isWatching: Schema.Boolean,             // Whether file watchers are active
    lastScanA: Schema.optional(Schema.DateFromNumber), // Last scan of dir A
    lastScanB: Schema.optional(Schema.DateFromNumber), // Last scan of dir B
    conflictResolutionStrategy: Schema.Literal(
      'manual',       // Always prompt user
      'auto-newest',  // Always keep newest file
      'auto-largest', // Always keep largest file
      'skip-conflicts' // Skip conflicted files
    ),
    totalFiles: Schema.Number,              // Total files being tracked
    syncedFiles: Schema.Number,             // Files successfully synced
    conflictedFiles: Schema.Number,         // Files with unresolved conflicts
  }),
  default: { 
    id: SessionIdSymbol, 
    value: { 
      dirA: '', 
      dirB: '', 
      isWatching: false,
      conflictResolutionStrategy: 'manual',
      totalFiles: 0,
      syncedFiles: 0,
      conflictedFiles: 0,
    } 
  },
})
```

## Materializers Design

### File Lifecycle Materializers

```typescript
const fileMaterializers = State.SQLite.materializers(events, {
  'v1.FileDetected': ({ id, path, size, mtime, hash, sourceDir, detectedAt }) => {
    const dirColumn = sourceDir === 'a' ? 'pathA' : 'pathB'
    const presentColumn = sourceDir === 'a' ? 'presentInA' : 'presentInB'
    
    return State.SQLite.transaction([
      // Insert or update file record
      tables.files.insertOrReplace({
        id,
        [dirColumn]: path,
        [presentColumn]: true,
        size,
        mtime,  
        hash,
        createdAt: detectedAt,
        modifiedAt: detectedAt,
        conflictState: null,
      }),
    ])
  },
  
  'v1.FileModified': ({ id, newHash, newMtime, newSize, sourceDir, modifiedAt }) => {
    const operations = [
      tables.files.update({
        hash: newHash,
        mtime: newMtime,
        size: newSize,
        modifiedAt,
      }).where({ id })
    ]
    
    // Check if this creates a conflict by querying existing state
    const existingFile = State.SQLite.query(
      tables.files.select(['hash', 'presentInA', 'presentInB']).where({ id })
    )
    
    if (existingFile) {
      const otherDir = sourceDir === 'a' ? 'b' : 'a'
      const otherPresent = otherDir === 'a' ? existingFile.presentInA : existingFile.presentInB
      
      // If file exists in both dirs with different hashes, mark as conflict
      if (otherPresent && existingFile.hash !== newHash) {
        operations.push(
          tables.files.update({ conflictState: 'conflict' }).where({ id })
        )
      }
    }
    
    return State.SQLite.transaction(operations)
  },
  
  'v1.FileDeleted': ({ id, sourceDir, deletedAt }) => {
    const presentColumn = sourceDir === 'a' ? 'presentInA' : 'presentInB'
    const pathColumn = sourceDir === 'a' ? 'pathA' : 'pathB'
    
    return State.SQLite.transaction([
      tables.files.update({
        [presentColumn]: false,
        [pathColumn]: null,
        deletedAt,
        modifiedAt: deletedAt,
      }).where({ id }),
    ])
  },
})
```

### Conflict Handling Materializers

```typescript
const conflictMaterializers = State.SQLite.materializers(conflictEvents, {
  'v1.ConflictDetected': ({ id, hashA, hashB, mtimeA, mtimeB, conflictType, detectedAt }) => {
    const conflictId = `${id}-${detectedAt.getTime()}`
    
    return State.SQLite.transaction([
      // Mark file as conflicted
      tables.files.update({ conflictState: 'conflict' }).where({ id }),
      
      // Record the conflict details
      tables.conflicts.insert({
        id: conflictId,
        fileId: id,
        conflictType,
        hashA,
        hashB,
        mtimeA,
        mtimeB,
        detectedAt,
      }),
    ])
  },
  
  'v1.ConflictResolved': ({ id, resolution, resolvedAt, resolvedBy }) => {
    return State.SQLite.transaction([
      // Clear conflict state from file
      tables.files.update({ 
        conflictState: null,
        lastSyncedAt: resolvedAt,
      }).where({ id }),
      
      // Update conflict record with resolution
      tables.conflicts.update({ 
        resolution, 
        resolvedAt, 
        resolvedBy 
      }).where({ fileId: id, resolvedAt: null }),
    ])
  },
})
```

### Sync Operation Materializers

```typescript
const syncMaterializers = State.SQLite.materializers(syncEvents, {
  'v1.SyncCompleted': ({ id, fromDir, toDir, syncType, completedAt }) => {
    return State.SQLite.transaction([
      tables.files.update({ 
        lastSyncedAt: completedAt,
        modifiedAt: completedAt,
        // Update presence based on sync type
        ...(syncType === 'copy' ? {
          [toDir === 'a' ? 'presentInA' : 'presentInB']: true
        } : {}),
        ...(syncType === 'delete' ? {
          [toDir === 'a' ? 'presentInA' : 'presentInB']: false
        } : {}),
      }).where({ id }),
    ])
  },
})
```

## User vs App Change Detection

### Challenge

The system must differentiate between:
- **User changes**: Manual file modifications/creations/deletions
- **App changes**: Modifications made by the sync process itself

### Detection Strategies

#### 1. Sync Intent Tracking
```typescript
// Before syncing a file, emit intent event
yield* store.commit(events.syncIntent({ 
  id: 'path/to/file.txt', 
  fromDir: 'a', 
  toDir: 'b',
  syncType: 'copy',
  intentAt: new Date(),
}))

// Perform file operation
yield* FileSystem.copyFile(sourcePath, destPath)

// After completion, emit completion event
yield* store.commit(events.syncCompleted({
  id: 'path/to/file.txt',
  fromDir: 'a', 
  toDir: 'b',
  syncType: 'copy', 
  completedAt: new Date(),
}))
```

#### 2. Timestamp Window Filtering
```typescript
// Ignore file changes within small window after sync completion
const isLikelyAppChange = (fileChange: FileChangeEvent): boolean => {
  const recentSyncs = queryDb(tables.files.select()
    .where({ id: fileChange.id })
    .where(sql`lastSyncedAt > ${fileChange.detectedAt.getTime() - 2000}`) // 2s window
  )
  
  return recentSyncs.length > 0
}
```

#### 3. Content Hash Restoration
```typescript
// If file changes back to a previously known hash, it's likely a sync
const isHashRestoration = (fileChange: FileChangeEvent): boolean => {
  const previousHashes = queryDb(
    sql`SELECT DISTINCT hash FROM file_history WHERE file_id = ${fileChange.id}`
  )
  
  return previousHashes.some(row => row.hash === fileChange.newHash)
}
```

#### 4. File Lock Coordination
```typescript
// Use file system locks during sync operations
const performSyncWithLock = (filePath: string) =>
  Effect.gen(function* () {
    const lockFile = `${filePath}.sync-lock`
    
    yield* FileSystem.writeFile(lockFile, 'syncing')
    
    try {
      yield* performFileOperation(filePath)
    } finally {
      yield* FileSystem.deleteFile(lockFile).pipe(Effect.ignore)
    }
  })

// File watcher ignores changes to locked files
const shouldIgnoreChange = (filePath: string): Effect.Effect<boolean> =>
  FileSystem.exists(`${filePath}.sync-lock`)
```

## Conflict Resolution Strategies

### Automatic Resolution

```typescript
type ConflictResolutionStrategy =
  | 'auto-newest'    // Keep file with most recent mtime
  | 'auto-largest'   // Keep file with largest size
  | 'auto-smallest'  // Keep file with smallest size
  | 'keep-a'         // Always keep version from directory A
  | 'keep-b'         // Always keep version from directory B
  | 'skip'           // Don't sync conflicted files
```

### Interactive Resolution

```typescript
const resolveConflictInteractively = (conflict: ConflictInfo) =>
  Effect.gen(function* () {
    yield* Effect.log(`\nConflict detected for: ${conflict.fileId}`)
    yield* Effect.log(`Directory A: ${conflict.hashA} (modified ${conflict.mtimeA})`)
    yield* Effect.log(`Directory B: ${conflict.hashB} (modified ${conflict.mtimeB})`)
    
    const choice = yield* Cli.Prompt.select({
      message: 'How should this conflict be resolved?',
      choices: [
        { name: 'Keep version from Directory A', value: 'keep-a' },
        { name: 'Keep version from Directory B', value: 'keep-b' },
        { name: 'Skip this file (no sync)', value: 'skip' },
        { name: 'View file contents', value: 'view' },
      ]
    })
    
    if (choice === 'view') {
      yield* showFileDiff(conflict.fileId)
      return yield* resolveConflictInteractively(conflict)
    }
    
    return choice
  })
```

### Merge Resolution (Future Enhancement)

For text files, implement three-way merge:
- **Base**: Last common version before conflict
- **Ours**: Version from directory A
- **Theirs**: Version from directory B

## File System Watching Strategy

### Cross-Platform File Watching

Use `chokidar` for reliable cross-platform file system monitoring:

```typescript
import chokidar from 'chokidar'

export class FileWatcherService extends Effect.Service<FileWatcherService>() {
  static make = Effect.gen(function* () {
    const watchDirectory = (dirPath: string, sourceDir: 'a' | 'b') =>
      Effect.gen(function* () {
        const watcher = chokidar.watch(dirPath, {
          persistent: true,
          ignoreInitial: false,
          followSymlinks: false,
          cwd: dirPath,
          depth: undefined,
          ignorePermissionErrors: false,
          ignored: [
            // Ignore sync lock files
            '**/*.sync-lock',
            // Ignore common system files
            '**/.DS_Store',
            '**/Thumbs.db',
            '**/$RECYCLE.BIN/**',
            '**/System Volume Information/**',
          ],
        })
        
        const eventQueue = Queue.unbounded<WatchEvent>()
        
        // Batch events to avoid storm during rapid changes
        const batchedEvents = eventQueue.pipe(
          Stream.groupedWithin(100, Duration.seconds(1)),
          Stream.map(events => deduplicateEvents(events))
        )
        
        // Transform filesystem events to LiveStore events
        return batchedEvents.pipe(
          Stream.mapEffect(events => 
            Effect.forEach(events, event => 
              transformToLiveStoreEvent(event, sourceDir)
            )
          )
        )
      })
    
    return { watchDirectory } as const
  })
}
```

### Event Batching and Deduplication

```typescript
const deduplicateEvents = (events: WatchEvent[]): WatchEvent[] => {
  // Keep only the latest event per file path
  const eventMap = new Map<string, WatchEvent>()
  
  for (const event of events) {
    const existing = eventMap.get(event.path)
    
    if (!existing || event.timestamp > existing.timestamp) {
      eventMap.set(event.path, event)
    }
  }
  
  return Array.from(eventMap.values())
}
```

### Hash Calculation Strategy

```typescript
const calculateFileHash = (filePath: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    // Use streaming hash calculation for large files
    const stream = yield* FileSystem.stream(filePath)
    const hash = crypto.createHash('sha256')
    
    yield* stream.pipe(
      Stream.run(Sink.forEach(chunk => Effect.sync(() => hash.update(chunk))))
    )
    
    return hash.digest('hex')
  })
```

## Performance Considerations

### Large File Handling

- **Streaming operations**: Use Node.js streams for large file operations
- **Chunked hashing**: Calculate hashes in chunks to avoid memory issues  
- **Progress reporting**: Show progress for large file operations
- **Partial sync**: Only sync changed portions of files (future enhancement)

### Directory Scanning Optimization

```typescript
const scanDirectoryIncremental = (dirPath: string, lastScan?: Date) =>
  Effect.gen(function* () {
    const entries = yield* FileSystem.readdir(dirPath, { withFileTypes: true })
    
    // Only process files modified since last scan
    const changedFiles = entries.filter(entry => 
      !lastScan || entry.stats.mtime > lastScan
    )
    
    return changedFiles
  })
```

### Event Batching Strategy

- **Time-based batching**: Group events within 1-second windows
- **Size-based batching**: Process up to 100 events at once
- **Deduplication**: Remove duplicate events for the same file
- **Priority queuing**: Process deletions before creations

### Memory Usage Optimization

- **Lazy loading**: Load file contents only when needed
- **Event cleanup**: Purge old events beyond retention period
- **Index optimization**: Efficient SQLite indexes for common queries
- **Stream processing**: Process large datasets as streams

## Implementation Phases

### Phase 1: Core Foundation ✅ (This PR)
- [ ] Project structure and configuration
- [ ] Comprehensive PLAN.md documentation
- [ ] Package.json with dependencies  
- [ ] TypeScript configuration
- [ ] Basic CLI scaffold

### Phase 2: Event Schema & State
- [ ] Define complete LiveStore schema (events + state)
- [ ] Implement materializers for all event types
- [ ] Create database queries for common operations
- [ ] Add comprehensive event validation

### Phase 3: File System Integration
- [ ] Implement FileWatcherService with chokidar
- [ ] Add file hash calculation utilities
- [ ] Create file system operation services
- [ ] Implement directory scanning logic

### Phase 4: Sync Engine
- [ ] Build core SyncEngineService
- [ ] Implement bidirectional sync logic
- [ ] Add sync intent tracking
- [ ] Create file operation batching

### Phase 5: Conflict Detection & Resolution
- [ ] Implement ConflictResolverService
- [ ] Add automatic resolution strategies
- [ ] Create interactive conflict resolution
- [ ] Build conflict audit trail

### Phase 6: CLI Commands
- [ ] Implement `sync` command for one-time sync
- [ ] Build `watch` command for continuous monitoring
- [ ] Add `status` command for sync state display
- [ ] Create `conflicts` command group

### Phase 7: Advanced Features
- [ ] User vs app change detection
- [ ] Performance optimizations
- [ ] Error recovery mechanisms
- [ ] Comprehensive logging and telemetry

### Phase 8: Testing & Documentation
- [ ] Unit tests for all services
- [ ] Integration tests with real file systems
- [ ] Performance benchmarks
- [ ] User documentation and examples

## File Structure

```
examples/file-sync/
├── README.md                    # Quick start guide
├── PLAN.md                      # This comprehensive design doc
├── package.json                 # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
└── src/
    ├── main.ts                  # CLI entry point and command routing
    ├── commands/
    │   ├── sync.ts              # One-time sync command implementation
    │   ├── watch.ts             # Continuous watch command
    │   ├── status.ts            # Status display and reporting  
    │   └── conflicts.ts         # Conflict management commands
    ├── services/
    │   ├── file-watcher.ts      # File system monitoring service
    │   ├── sync-engine.ts       # Core bidirectional sync logic
    │   ├── conflict-resolver.ts # Conflict detection and resolution
    │   └── hash-calculator.ts   # File content hashing utilities
    ├── livestore/
    │   ├── schema.ts            # Events, state tables, and materializers
    │   └── queries.ts           # Database queries for common operations
    └── utils/
        ├── file-utils.ts        # File system utility functions
        ├── path-utils.ts        # Path normalization and utilities
        └── cli-utils.ts         # CLI formatting and interaction helpers
```

## Technical Dependencies

### Core Dependencies
- `@livestore/*` - Event sourcing and state management
- `effect` - Functional programming and error handling
- `chokidar` - Cross-platform file system watching
- `@effect/cli` - Command line interface framework

### Utility Dependencies  
- `crypto` (Node.js built-in) - File content hashing
- `path` (Node.js built-in) - Path manipulation
- `fs/promises` (Node.js built-in) - Async file system operations

### Development Dependencies
- `typescript` - Type checking and compilation
- `vitest` - Testing framework  
- `@types/node` - Node.js type definitions

## Success Criteria

The file sync system will be considered complete when:

1. **✅ Bidirectional sync works reliably** - Changes in either directory propagate correctly
2. **✅ Conflicts are detected and resolved** - Concurrent modifications handled gracefully  
3. **✅ User vs app changes differentiated** - Sync operations don't trigger recursive syncing
4. **✅ Performance is acceptable** - Large directories sync efficiently
5. **✅ CLI provides good UX** - Clear commands, helpful output, error messages
6. **✅ Event audit trail is complete** - Full history of all file operations
7. **✅ Error recovery works** - Network issues, permission errors, etc. handled
8. **✅ Type safety maintained** - All operations properly typed with Effect

This system will serve as both a useful file sync tool and a comprehensive example of building complex, stateful CLI applications with LiveStore and Effect.