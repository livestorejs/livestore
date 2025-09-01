/**
 * HYPOTHESIS 4: File System Performance Issues
 * 
 * Theory: CI uses slower storage causing I/O bottlenecks:
 * - Network-attached storage vs local SSD
 * - Overlay filesystems in containers
 * - SQLite fsync performance degradation
 * - Temporary file operations
 * - Directory scanning overhead
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Duration, Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { 
  createHypothesisTest, 
  environmentChecks, 
  measureTiming 
} from './hypothesis-base.ts'

const timeout = Duration.toMillis(Duration.minutes(30))

Vitest.describe('Hypothesis 4: File System Performance', { timeout }, () => {

  // Test 4.1: Basic file I/O benchmark
  createHypothesisTest(
    'H4.1-BasicFileIO',
    'Benchmark basic file system operations',
    Effect.gen(function* () {
      yield* environmentChecks.verifyEnvironment
      
      yield* Effect.log('💾 Testing basic file I/O performance...')
      
      const testDir = path.join(os.tmpdir(), `fs-test-${Date.now()}`)
      
      // Create test directory
      const { measurement: mkdir } = yield* measureTiming(
        'mkdir-operation',
        Effect.try({
          try: () => fs.mkdirSync(testDir, { recursive: true }),
          catch: (error) => new Error(`mkdir failed: ${error}`),
        }),
      )
      
      // Write test file
      const testFile = path.join(testDir, 'test.txt')
      const testData = 'x'.repeat(1024 * 1024) // 1MB
      
      const { measurement: writeFile } = yield* measureTiming(
        'write-1mb-file',
        Effect.try({
          try: () => fs.writeFileSync(testFile, testData),
          catch: (error) => new Error(`write failed: ${error}`),
        }),
      )
      
      // Read test file
      const { measurement: readFile } = yield* measureTiming(
        'read-1mb-file',
        Effect.try({
          try: () => fs.readFileSync(testFile, 'utf8'),
          catch: (error) => new Error(`read failed: ${error}`),
        }),
      )
      
      // Test fsync
      const { measurement: fsync } = yield* measureTiming(
        'fsync-operation',
        Effect.try({
          try: () => {
            const fd = fs.openSync(testFile, 'r+')
            fs.fsyncSync(fd)
            fs.closeSync(fd)
          },
          catch: (error) => new Error(`fsync failed: ${error}`),
        }),
      )
      
      // Test many small files
      const smallFileCount = 100
      const { measurement: manyFiles } = yield* measureTiming(
        `create-${smallFileCount}-small-files`,
        Effect.try({
          try: () => {
            for (let i = 0; i < smallFileCount; i++) {
              fs.writeFileSync(path.join(testDir, `small-${i}.txt`), `data-${i}`)
            }
          },
          catch: (error) => new Error(`many files failed: ${error}`),
        }),
      )
      
      // Cleanup
      yield* Effect.try({
        try: () => fs.rmSync(testDir, { recursive: true }),
        catch: () => undefined, // Ignore cleanup errors
      })
      
      yield* Effect.log('📊 File I/O Analysis', {
        mkdir: `${mkdir.durationMs}ms`,
        write1MB: `${writeFile.durationMs}ms (${Math.round(1024 / writeFile.durationMs * 1000)}MB/s)`,
        read1MB: `${readFile.durationMs}ms (${Math.round(1024 / readFile.durationMs * 1000)}MB/s)`,
        fsync: `${fsync.durationMs}ms`,
        manySmallFiles: `${manyFiles.durationMs}ms (${Math.round(smallFileCount / manyFiles.durationMs * 1000)} files/s)`,
        performance: writeFile.durationMs < 50 ? 'FAST' : writeFile.durationMs < 200 ? 'MEDIUM' : 'SLOW',
      })

      return { mkdir, writeFile, readFile, fsync, manyFiles }
    }),
  )

  // Test 4.2: SQLite performance benchmark
  createHypothesisTest(
    'H4.2-SQLitePerformance',
    'Test SQLite operations that mirror test workload',
    Effect.gen(function* () {
      yield* Effect.log('🗄️ Testing SQLite performance...')
      
      const dbPath = path.join(os.tmpdir(), `sqlite-test-${Date.now()}.db`)
      
      // Import better-sqlite3 dynamically to handle potential missing dependency
      const Database = yield* Effect.try({
        try: () => require('better-sqlite3'),
        catch: (error) => {
          console.warn('better-sqlite3 not available, using simulated timing:', error)
          return null
        },
      })
      
      if (!Database) {
        // Simulate SQLite timings if library not available
        yield* Effect.log('📊 SQLite Analysis (Simulated)', {
          note: 'better-sqlite3 not available',
          recommendation: 'Install better-sqlite3 for actual SQLite testing',
        })
        return { simulated: true }
      }
      
      // Test SQLite operations
      const { measurement: dbInit } = yield* measureTiming(
        'sqlite-initialization',
        Effect.try({
          try: () => {
            const db = new Database(dbPath)
            db.exec(`
              CREATE TABLE todos (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s','now'))
              )
            `)
            return db
          },
          catch: (error) => new Error(`SQLite init failed: ${error}`),
        }),
      )
      
      const db = (dbInit as any).result
      if (!db) return { dbInit }
      
      // Test bulk inserts (simulating todo creation)
      const insertCount = 451 // Same as failing test
      const { measurement: bulkInsert } = yield* measureTiming(
        `sqlite-bulk-insert-${insertCount}`,
        Effect.try({
          try: () => {
            const stmt = db.prepare('INSERT INTO todos (id, text) VALUES (?, ?)')
            const insertMany = db.transaction((todos: any[]) => {
              for (const todo of todos) {
                stmt.run(todo.id, todo.text)
              }
            })
            
            const todos = Array.from({ length: insertCount }, (_, i) => ({
              id: `todo-${i}`,
              text: `Test todo ${i}`,
            }))
            
            insertMany(todos)
            return insertCount
          },
          catch: (error) => new Error(`bulk insert failed: ${error}`),
        }),
      )
      
      // Test query performance
      const { measurement: queryAll } = yield* measureTiming(
        'sqlite-query-all',
        Effect.try({
          try: () => {
            const stmt = db.prepare('SELECT * FROM todos')
            return stmt.all()
          },
          catch: (error) => new Error(`query failed: ${error}`),
        }),
      )
      
      // Test transaction performance
      const { measurement: transaction } = yield* measureTiming(
        'sqlite-transaction-updates',
        Effect.try({
          try: () => {
            const updateStmt = db.prepare('UPDATE todos SET completed = 1 WHERE id = ?')
            const updateMany = db.transaction((ids: string[]) => {
              for (const id of ids) {
                updateStmt.run(id)
              }
            })
            
            const idsToUpdate = Array.from({ length: 100 }, (_, i) => `todo-${i}`)
            updateMany(idsToUpdate)
            return idsToUpdate.length
          },
          catch: (error) => new Error(`transaction failed: ${error}`),
        }),
      )
      
      // Cleanup
      yield* Effect.try({
        try: () => {
          db.close()
          fs.unlinkSync(dbPath)
        },
        catch: () => undefined,
      })
      
      yield* Effect.log('📊 SQLite Performance Analysis', {
        initialization: `${dbInit.durationMs}ms`,
        bulkInsert: `${bulkInsert.durationMs}ms (${Math.round(insertCount / bulkInsert.durationMs * 1000)} ops/s)`,
        queryAll: `${queryAll.durationMs}ms`,
        transaction: `${transaction.durationMs}ms`,
        performance: bulkInsert.durationMs < 100 ? 'EXCELLENT' : bulkInsert.durationMs < 500 ? 'GOOD' : 'POOR',
      })

      return { dbInit, bulkInsert, queryAll, transaction }
    }),
  )

  // Test 4.3: File system type and mount information
  createHypothesisTest(
    'H4.3-FileSystemInfo',
    'Analyze file system type and mount characteristics',
    Effect.gen(function* () {
      yield* Effect.log('🔍 Analyzing file system characteristics...')
      
      // Get file system info
      const { measurement: fsInfo } = yield* measureTiming(
        'filesystem-analysis',
        Effect.gen(function* () {
          const { Command } = yield* Effect.serviceConstants(PlatformNode.NodeContext)
          
          // Get mount information
          const mountInfo = yield* Command.make('df', '-T', '.').pipe(
            Command.stdout('string'),
            Effect.catchAll(() => Effect.succeed('mount info unavailable')),
          )
          
          // Get file system performance info
          const tmpDir = os.tmpdir()
          const statInfo = yield* Command.make('stat', '-f', tmpDir).pipe(
            Command.stdout('string'),
            Effect.catchAll(() => Effect.succeed('stat info unavailable')),
          )
          
          return { mountInfo, statInfo, tmpDir }
        }).pipe(
          Effect.provide(PlatformNode.NodeContext.layer),
        ),
      )
      
      const result = (fsInfo as any).result || {}
      
      yield* Effect.log('📊 File System Analysis', {
        mountInfo: result.mountInfo ? 'Available' : 'N/A',
        statInfo: result.statInfo ? 'Available' : 'N/A',
        tmpDir: result.tmpDir,
        analysisTime: `${fsInfo.durationMs}ms`,
      })
      
      if (result.mountInfo && typeof result.mountInfo === 'string') {
        const lines = result.mountInfo.split('\n')
        if (lines.length > 1) {
          yield* Effect.log('🗂️ Mount Details', {
            filesystem: lines[1],
          })
        }
      }

      return { fsInfo, ...result }
    }),
  )

  // Test 4.4: Directory operations stress test
  createHypothesisTest(
    'H4.4-DirectoryOperations',
    'Test directory operations that might affect test performance',
    Effect.gen(function* () {
      yield* Effect.log('📁 Testing directory operations...')
      
      const testDir = path.join(os.tmpdir(), `dir-test-${Date.now()}`)
      
      // Test deep directory creation
      const { measurement: deepDir } = yield* measureTiming(
        'deep-directory-creation',
        Effect.try({
          try: () => {
            const deepPath = path.join(testDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g')
            fs.mkdirSync(deepPath, { recursive: true })
            return deepPath
          },
          catch: (error) => new Error(`deep dir creation failed: ${error}`),
        }),
      )
      
      // Test many file creation (simulating test artifacts)
      const fileCount = 500
      const { measurement: manyFiles } = yield* measureTiming(
        `create-${fileCount}-files`,
        Effect.try({
          try: () => {
            for (let i = 0; i < fileCount; i++) {
              const filePath = path.join(testDir, `file-${i}.log`)
              fs.writeFileSync(filePath, `log entry ${i}\n`)
            }
            return fileCount
          },
          catch: (error) => new Error(`many files creation failed: ${error}`),
        }),
      )
      
      // Test directory scanning
      const { measurement: dirScan } = yield* measureTiming(
        'directory-scan-recursive',
        Effect.try({
          try: () => {
            const scanDir = (dir: string): number => {
              let count = 0
              const items = fs.readdirSync(dir)
              for (const item of items) {
                const itemPath = path.join(dir, item)
                const stat = fs.statSync(itemPath)
                if (stat.isDirectory()) {
                  count += scanDir(itemPath)
                } else {
                  count++
                }
              }
              return count
            }
            return scanDir(testDir)
          },
          catch: (error) => new Error(`directory scan failed: ${error}`),
        }),
      )
      
      // Cleanup
      yield* Effect.try({
        try: () => fs.rmSync(testDir, { recursive: true }),
        catch: () => undefined,
      })
      
      yield* Effect.log('📊 Directory Operations Analysis', {
        deepDirectoryCreation: `${deepDir.durationMs}ms`,
        manyFilesCreation: `${manyFiles.durationMs}ms (${Math.round(fileCount / manyFiles.durationMs * 1000)} files/s)`,
        directoryScan: `${dirScan.durationMs}ms`,
        performance: manyFiles.durationMs < 500 ? 'FAST' : manyFiles.durationMs < 2000 ? 'MEDIUM' : 'SLOW',
      })

      return { deepDir, manyFiles, dirScan }
    }),
  )

  // Test 4.5: Simulated test workspace operations
  createHypothesisTest(
    'H4.5-TestWorkspaceIO',
    'Simulate the file operations that occur during node-sync tests',
    Effect.gen(function* () {
      yield* Effect.log('🧪 Testing simulated workspace I/O...')
      
      const workspaceDir = path.join(os.tmpdir(), `workspace-test-${Date.now()}`)
      
      // Simulate test setup: create directory structure
      const { measurement: setup } = yield* measureTiming(
        'test-workspace-setup',
        Effect.try({
          try: () => {
            fs.mkdirSync(workspaceDir, { recursive: true })
            fs.mkdirSync(path.join(workspaceDir, 'tmp', 'logs'), { recursive: true })
            fs.mkdirSync(path.join(workspaceDir, '.wrangler'), { recursive: true })
            
            // Create some config files
            fs.writeFileSync(path.join(workspaceDir, 'wrangler.toml'), `
name = "test-worker"
main = "src/index.ts"
compatibility_date = "2023-12-01"
`)
            fs.writeFileSync(path.join(workspaceDir, 'package.json'), '{"type": "module"}')
            
            return workspaceDir
          },
          catch: (error) => new Error(`workspace setup failed: ${error}`),
        }),
      )
      
      // Simulate log file writing (continuous during test)
      const logEntries = 1000
      const { measurement: logWriting } = yield* measureTiming(
        `write-${logEntries}-log-entries`,
        Effect.try({
          try: () => {
            const logFile = path.join(workspaceDir, 'tmp', 'logs', 'test.log')
            const logStream = fs.createWriteStream(logFile, { flags: 'a' })
            
            for (let i = 0; i < logEntries; i++) {
              logStream.write(`[${new Date().toISOString()}] Test log entry ${i}\n`)
            }
            
            logStream.end()
            return logEntries
          },
          catch: (error) => new Error(`log writing failed: ${error}`),
        }),
      )
      
      // Test file watching (if available)
      const { measurement: fileWatch } = yield* measureTiming(
        'file-watch-setup',
        Effect.try({
          try: () => {
            const watchFile = path.join(workspaceDir, 'watch-target.txt')
            fs.writeFileSync(watchFile, 'initial')
            
            const watcher = fs.watch(watchFile, () => {})
            watcher.close()
            
            return 'watch-ok'
          },
          catch: (error) => new Error(`file watch failed: ${error}`),
        }),
      )
      
      // Cleanup
      yield* Effect.try({
        try: () => fs.rmSync(workspaceDir, { recursive: true }),
        catch: () => undefined,
      })
      
      yield* Effect.log('📊 Workspace I/O Analysis', {
        setup: `${setup.durationMs}ms`,
        logWriting: `${logWriting.durationMs}ms (${Math.round(logEntries / logWriting.durationMs * 1000)} entries/s)`,
        fileWatch: `${fileWatch.durationMs}ms`,
        workspaceEfficiency: setup.durationMs < 100 ? 'EXCELLENT' : setup.durationMs < 500 ? 'GOOD' : 'POOR',
      })

      return { setup, logWriting, fileWatch }
    }),
  )

  // Test 4.6: Disk space and performance under pressure
  createHypothesisTest(
    'H4.6-DiskPressure',
    'Test file system performance under disk pressure',
    Effect.gen(function* () {
      yield* Effect.log('💿 Testing file system under disk pressure...')
      
      // Check available disk space
      const { measurement: diskCheck } = yield* measureTiming(
        'disk-space-check',
        Effect.gen(function* () {
          const { Command } = yield* Effect.serviceConstants(PlatformNode.NodeContext)
          
          const output = yield* Command.make('df', '-h', os.tmpdir()).pipe(
            Command.stdout('string'),
            Effect.catchAll(() => Effect.succeed('disk info unavailable')),
          )
          
          return output
        }).pipe(
          Effect.provide(PlatformNode.NodeContext.layer),
        ),
      )
      
      const diskInfo = (diskCheck as any).result || ''
      
      // Parse disk usage if available
      let availableSpace = 'unknown'
      if (typeof diskInfo === 'string' && diskInfo.includes('%')) {
        const lines = diskInfo.split('\n')
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/)
          availableSpace = parts[3] || 'unknown'
        }
      }
      
      yield* Effect.log('📊 Disk Pressure Analysis', {
        diskCheckTime: `${diskCheck.durationMs}ms`,
        availableSpace: availableSpace,
        diskHealth: diskCheck.durationMs < 50 ? 'FAST' : 'SLOW',
      })

      return { diskCheck, diskInfo, availableSpace }
    }),
  )
})