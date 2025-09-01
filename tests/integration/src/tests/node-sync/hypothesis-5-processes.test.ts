/**
 * HYPOTHESIS 5: Process Management Overhead
 *
 * Theory: Process tree operations are expensive in CI causing delays:
 * - Orphaned process cleanup takes too long
 * - Process spawning is slow
 * - Signal delivery and process termination delays
 * - PID namespace issues in containers
 * - Zombie process accumulation
 */

import * as ChildProcess from 'node:child_process'
import { Command, Duration, Effect, Worker } from '@livestore/utils/effect'
import { ChildProcessWorker, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { makeFileLogger } from './fixtures/file-logger.ts'
import { createHypothesisTest, environmentChecks, measureTiming } from './hypothesis-base.ts'
import * as WorkerSchema from './worker-schema.ts'

const timeout = Duration.toMillis(Duration.minutes(30))

Vitest.describe('Hypothesis 5: Process Management Overhead', { timeout }, () => {
  // Test 5.1: Process tree analysis
  createHypothesisTest(
    'H5.1-ProcessTreeAnalysis',
    'Analyze current process tree and detect orphaned processes',
    Effect.gen(function* () {
      yield* environmentChecks.verifyEnvironment()
      yield* environmentChecks.checkOrphanedProcesses()

      yield* Effect.log('🌳 Analyzing process tree...')

      // Get detailed process tree
      const { measurement } = yield* measureTiming(
        'process-tree-analysis',
        Effect.gen(function* () {
          // Get process tree
          const pstree = yield* Command.make('pstree', '-p').pipe(
            Command.string,
            Effect.catchAll(() =>
              // Fallback for systems without pstree
              Command.make('ps', 'auxf').pipe(Command.string),
            ),
          )

          // Count specific process types
          const nodeProcs = yield* Command.make('pgrep', '-c', '-f', 'node').pipe(
            Command.string,
            Effect.map((output) => Number.parseInt(output.trim(), 10) || 0),
            Effect.catchAll(() => Effect.succeed(0)),
          )

          const wranglerProcs = yield* Command.make('pgrep', '-c', '-f', 'wrangler').pipe(
            Command.string,
            Effect.map((output) => Number.parseInt(output.trim(), 10) || 0),
            Effect.catchAll(() => Effect.succeed(0)),
          )

          const workerdProcs = yield* Command.make('pgrep', '-c', '-f', 'workerd').pipe(
            Command.string,
            Effect.map((output) => Number.parseInt(output.trim(), 10) || 0),
            Effect.catchAll(() => Effect.succeed(0)),
          )

          return { pstree, nodeProcs, wranglerProcs, workerdProcs }
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      const result = (measurement as any).result || {}

      yield* Effect.log('📊 Process Tree Analysis', {
        analysisTime: `${measurement.durationMs}ms`,
        nodeProcesses: result.nodeProcs || 0,
        wranglerProcesses: result.wranglerProcs || 0,
        workerdProcesses: result.workerdProcs || 0,
        totalRelevant: (result.nodeProcs || 0) + (result.wranglerProcs || 0) + (result.workerdProcs || 0),
        efficiency: measurement.durationMs < 100 ? 'FAST' : 'SLOW',
      })

      return { measurement, ...result }
    }),
  )

  // Test 5.2: Process spawning performance
  createHypothesisTest(
    'H5.2-ProcessSpawning',
    'Measure child process creation and termination speed',
    Effect.gen(function* () {
      yield* Effect.log('🚀 Testing process spawning performance...')

      const processCount = 5
      const spawnTimings = []

      for (let i = 0; i < processCount; i++) {
        const { measurement } = yield* measureTiming(
          `spawn-process-${i + 1}`,
          Effect.async<number>((resume) => {
            const child = ChildProcess.spawn('node', ['-e', 'console.log("Hello from child"); process.exit(0)'], {
              stdio: 'pipe',
            })

            child.on('exit', (_code) => {
              resume(Effect.succeed(child.pid || -1))
            })

            child.on('error', (error) => {
              resume(Effect.fail(error))
            })
          }),
        )

        spawnTimings.push(measurement.durationMs)

        yield* Effect.log(`Process ${i + 1}: ${measurement.durationMs}ms (${measurement.success ? 'OK' : 'FAILED'})`)

        // Brief pause
        yield* Effect.sleep(Duration.millis(100))
      }

      const avgSpawnTime = spawnTimings.reduce((a, b) => a + b, 0) / spawnTimings.length
      const maxSpawnTime = Math.max(...spawnTimings)

      yield* Effect.log('📊 Process Spawning Analysis', {
        processesSpawned: processCount,
        averageTime: `${Math.round(avgSpawnTime)}ms`,
        maxTime: `${maxSpawnTime}ms`,
        efficiency: avgSpawnTime < 50 ? 'EXCELLENT' : avgSpawnTime < 200 ? 'GOOD' : 'POOR',
        variation: `${Math.round(maxSpawnTime - Math.min(...spawnTimings))}ms`,
      })

      return { spawnTimings, avgSpawnTime, maxSpawnTime }
    }),
  )

  // Test 5.3: Worker process lifecycle timing
  createHypothesisTest(
    'H5.3-WorkerLifecycle',
    'Measure full worker process lifecycle performance',
    Effect.gen(function* () {
      yield* Effect.log('⚙️ Testing worker process lifecycle...')

      const { measurement } = yield* measureTiming(
        'worker-full-lifecycle',
        Effect.gen(function* () {
          const storeId = 'lifecycle-test'

          const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
            size: 1,
            concurrency: 100,
            initialMessage: () =>
              WorkerSchema.InitialMessage.make({
                storeId,
                clientId: 'lifecycle-client',
                adapterType: 'worker',
                storageType: 'in-memory',
                syncUrl: 'http://localhost:8787', // Dummy URL
              }),
          }).pipe(
            Effect.provide(
              ChildProcessWorker.layer(() =>
                ChildProcess.fork(new URL('./client-node-worker.ts', import.meta.url), ['lifecycle-client']),
              ),
            ),
            Effect.withSpan('lifecycle-worker'),
          )

          // Test worker communication
          yield* worker.executeEffect(WorkerSchema.CreateTodos.make({ count: 5 }))

          return worker
        }).pipe(
          Effect.provide(
            makeFileLogger('runner', { testContext: { task: { name: 'lifecycle', suite: { name: 'h5' } } } as any }),
          ),
          Effect.scoped,
        ),
      )

      yield* Effect.log('📊 Worker Lifecycle Analysis', {
        duration: `${measurement.durationMs}ms`,
        success: measurement.success,
        performance: measurement.durationMs < 2000 ? 'FAST' : measurement.durationMs < 5000 ? 'MEDIUM' : 'SLOW',
      })

      return { measurement }
    }),
  )

  // Test 5.4: Process cleanup timing
  createHypothesisTest(
    'H5.4-ProcessCleanup',
    'Measure process cleanup and termination performance',
    Effect.gen(function* () {
      yield* Effect.log('🧹 Testing process cleanup performance...')

      // Start some processes we can clean up
      const testProcesses: any[] = []

      // Create test processes
      for (let i = 0; i < 3; i++) {
        const child = ChildProcess.spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
          detached: false,
        })
        testProcesses.push(child.pid)
        yield* Effect.log(`Started test process ${i + 1}: PID ${child.pid}`)
      }

      yield* Effect.sleep(Duration.seconds(1)) // Let them settle

      // Test cleanup timing
      const { measurement } = yield* measureTiming(
        'process-cleanup',
        Effect.try({
          try: () => {
            let cleaned = 0
            for (const pid of testProcesses) {
              try {
                if (pid) {
                  process.kill(pid, 'SIGTERM')
                  cleaned++
                }
              } catch (_error) {
                // Process might already be dead
              }
            }
            return cleaned
          },
          catch: (error) => new Error(`cleanup failed: ${error}`),
        }),
      )

      // Wait for processes to actually terminate
      yield* Effect.sleep(Duration.seconds(2))

      // Verify cleanup
      const remaining = yield* Effect.try({
        try: () => {
          let count = 0
          for (const pid of testProcesses) {
            try {
              if (pid) {
                process.kill(pid, 0) // Test if process exists
                count++
              }
            } catch {
              // Process is dead, which is what we want
            }
          }
          return count
        },
        catch: () => 0,
      })

      yield* Effect.log('📊 Process Cleanup Analysis', {
        processesCreated: testProcesses.length,
        cleanupTime: `${measurement.durationMs}ms`,
        processesRemaining: remaining,
        cleanupEfficiency: remaining === 0 ? 'PERFECT' : remaining < testProcesses.length ? 'PARTIAL' : 'FAILED',
        timePerProcess: `${Math.round(measurement.durationMs / testProcesses.length)}ms`,
      })

      return { measurement, testProcesses, remaining }
    }),
  )

  // Test 5.5: Concurrent process operations
  createHypothesisTest(
    'H5.5-ConcurrentProcessOps',
    'Test concurrent process operations under load',
    Effect.gen(function* () {
      yield* Effect.log('🏃‍♂️ Testing concurrent process operations...')

      const { measurement } = yield* measureTiming(
        'concurrent-process-stress',
        Effect.gen(function* () {
          // Create multiple concurrent operations
          const operations = [
            // Operation 1: Start and stop multiple short-lived processes
            Effect.gen(function* () {
              for (let i = 0; i < 5; i++) {
                const child = ChildProcess.spawn('echo', [`hello-${i}`], { stdio: 'pipe' })
                yield* Effect.async<void>((resume) => {
                  child.on('exit', () => resume(Effect.void))
                  child.on('error', (error) => resume(Effect.fail(error)))
                })
              }
            }),

            // Operation 2: Check for existing processes repeatedly
            Effect.gen(function* () {
              for (let i = 0; i < 10; i++) {
                yield* Command.make('pgrep', '-f', 'node')
                  .pipe(
                    Command.string,
                    Effect.catchAll(() => Effect.succeed('')),
                  )
                  .pipe(Effect.provide(PlatformNode.NodeContext.layer))
                yield* Effect.sleep(Duration.millis(50))
              }
            }),

            // Operation 3: System process monitoring
            Effect.gen(function* () {
              for (let i = 0; i < 5; i++) {
                yield* Command.make('ps', 'aux')
                  .pipe(
                    Command.string,
                    Effect.map((output) => output.split('\n').length),
                  )
                  .pipe(Effect.provide(PlatformNode.NodeContext.layer))
                yield* Effect.sleep(Duration.millis(100))
              }
            }),
          ]

          // Run all operations concurrently
          yield* Effect.all(operations, { concurrency: 'unbounded' })

          return operations.length
        }),
      )

      yield* Effect.log('📊 Concurrent Process Operations Analysis', {
        duration: `${measurement.durationMs}ms`,
        success: measurement.success,
        concurrencyEfficiency:
          measurement.durationMs < 1000 ? 'EXCELLENT' : measurement.durationMs < 3000 ? 'GOOD' : 'POOR',
      })

      return { measurement }
    }),
  )
})
