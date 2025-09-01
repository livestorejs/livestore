/**
 * HYPOTHESIS 2: Resource Contention & Starvation
 *
 * Theory: CI runners have limited CPU/memory causing extreme slowdowns when:
 * - Multiple worker processes compete for resources
 * - Memory pressure causes swapping
 * - CPU scheduling becomes inefficient
 * - Container limits are hit
 */

import * as ChildProcess from 'node:child_process'
import { Duration, Effect, Layer, Worker } from '@livestore/utils/effect'
import { ChildProcessWorker, PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { makeFileLogger } from './fixtures/file-logger.ts'
import { collectSystemSnapshot, createHypothesisTest, environmentChecks, measureTiming } from './hypothesis-base.ts'
import * as WorkerSchema from './worker-schema.ts'

const timeout = Duration.toMillis(Duration.minutes(30))

const makeTestWorker = (clientId: string, storeId: string) =>
  Effect.gen(function* () {
    const server = yield* WranglerDevServerService
    return yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        WorkerSchema.InitialMessage.make({
          storeId,
          clientId,
          adapterType: 'worker',
          storageType: 'in-memory',
          syncUrl: server.url,
        }),
    }).pipe(
      Effect.provide(
        ChildProcessWorker.layer(() =>
          ChildProcess.fork(new URL('./client-node-worker.ts', import.meta.url), [clientId]),
        ),
      ),
      Effect.withSpan(`test-worker-${clientId}`),
    )
  })

Vitest.describe('Hypothesis 2: Resource Contention', { timeout }, () => {
  // Test 2.1: Baseline resource usage
  createHypothesisTest(
    'H2.1-BaselineResources',
    'Measure baseline resource usage without any workers',
    Effect.gen(function* () {
      yield* environmentChecks.verifyEnvironment

      const snapshots = []

      // Take initial snapshot
      snapshots.push(yield* collectSystemSnapshot)

      // Wait and take another snapshot to see baseline drift
      yield* Effect.sleep(Duration.seconds(5))
      snapshots.push(yield* collectSystemSnapshot)

      // Calculate resource drift
      const initial = snapshots[0]
      const final = snapshots[1]
      const memoryDrift = final.memory.used - initial.memory.used

      yield* Effect.log('📊 Baseline Resource Analysis', {
        memoryDrift: `${Math.round(memoryDrift / 1024 / 1024)}MB`,
        loadAvgChange: final.cpu.loadAverage[0] - initial.cpu.loadAverage[0],
        processChange: final.processes.total - initial.processes.total,
        stability: Math.abs(memoryDrift) < 50 * 1024 * 1024 ? 'STABLE' : 'UNSTABLE',
      })

      return { snapshots, memoryDrift }
    }),
  )

  // Test 2.2: Single worker resource usage
  createHypothesisTest(
    'H2.2-SingleWorkerResources',
    'Measure resource usage with one worker process',
    Effect.gen(function* () {
      yield* Effect.log('👤 Testing single worker resource usage...')

      const beforeSnapshot = yield* collectSystemSnapshot

      const { measurement } = yield* measureTiming(
        'single-worker-lifecycle',
        Effect.gen(function* () {
          const storeId = 'test-store-single'

          const worker = yield* makeTestWorker('single-client', storeId)

          // Do some work
          yield* worker.executeEffect(WorkerSchema.CreateTodos.make({ count: 10 }))

          // Let it settle
          yield* Effect.sleep(Duration.seconds(2))

          return worker
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeFileLogger('runner', {
                testContext: { task: { name: 'single-worker', suite: { name: 'h2' } } } as any,
              }),
              WranglerDevServerService.Default({ cwd: `${import.meta.dirname}/fixtures` }).pipe(
                Layer.provide(PlatformNode.NodeContext.layer),
              ),
            ),
          ),
          Effect.scoped,
        ),
      )

      const afterSnapshot = yield* collectSystemSnapshot

      const memoryIncrease = afterSnapshot.memory.used - beforeSnapshot.memory.used
      const processIncrease = afterSnapshot.processes.total - beforeSnapshot.processes.total

      yield* Effect.log('📊 Single Worker Resource Analysis', {
        duration: `${measurement.durationMs}ms`,
        memoryIncrease: `${Math.round(memoryIncrease / 1024 / 1024)}MB`,
        processIncrease: processIncrease,
        efficiency: measurement.durationMs < 5000 ? 'GOOD' : 'POOR',
      })

      return { measurement, memoryIncrease, processIncrease }
    }),
  )

  // Test 2.3: Multiple worker resource scaling
  createHypothesisTest(
    'H2.3-MultiWorkerScaling',
    'Test resource usage scaling with multiple concurrent workers',
    Effect.gen(function* () {
      yield* Effect.log('👥 Testing multiple worker resource scaling...')

      const workerCounts = [2, 4]
      const results = []

      for (const workerCount of workerCounts) {
        yield* Effect.log(`Testing with ${workerCount} workers...`)

        const beforeSnapshot = yield* collectSystemSnapshot

        const { measurement } = yield* measureTiming(
          `${workerCount}-workers`,
          Effect.gen(function* () {
            const storeId = `test-store-${workerCount}`

            const workers = yield* Effect.all(
              Array.from({ length: workerCount }, (_, i) => makeTestWorker(`client-${i}`, storeId)),
              { concurrency: 'unbounded' },
            )

            // Have all workers do some work concurrently
            yield* Effect.all(
              workers.map((worker, i) => worker.executeEffect(WorkerSchema.CreateTodos.make({ count: 20 + i * 10 }))),
              { concurrency: 'unbounded' },
            )

            yield* Effect.sleep(Duration.seconds(3))

            return workers.length
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                makeFileLogger('runner', {
                  testContext: { task: { name: `${workerCount}-workers`, suite: { name: 'h2' } } } as any,
                }),
                WranglerDevServerService.Default({ cwd: `${import.meta.dirname}/fixtures` }).pipe(
                  Layer.provide(PlatformNode.NodeContext.layer),
                ),
              ),
            ),
            Effect.scoped,
          ),
        )

        const afterSnapshot = yield* collectSystemSnapshot

        const memoryIncrease = afterSnapshot.memory.used - beforeSnapshot.memory.used
        const result = {
          workerCount,
          duration: measurement.durationMs,
          memoryIncrease,
          memoryPerWorker: memoryIncrease / workerCount,
          processIncrease: afterSnapshot.processes.total - beforeSnapshot.processes.total,
        }

        results.push(result)

        yield* Effect.log(`📊 ${workerCount} Workers Analysis`, {
          duration: `${result.duration}ms`,
          memoryTotal: `${Math.round(result.memoryIncrease / 1024 / 1024)}MB`,
          memoryPerWorker: `${Math.round(result.memoryPerWorker / 1024 / 1024)}MB`,
          processes: `+${result.processIncrease}`,
        })

        // Wait for cleanup
        yield* Effect.sleep(Duration.seconds(5))
      }

      // Analyze scaling efficiency
      const scaling = results[1].duration / results[0].duration
      const memoryScaling = results[1].memoryIncrease / results[0].memoryIncrease

      yield* Effect.log('📊 Scaling Analysis', {
        timeScaling: `${scaling.toFixed(2)}x (2x workers = ${scaling.toFixed(2)}x time)`,
        memoryScaling: `${memoryScaling.toFixed(2)}x`,
        efficiency: scaling < 2.5 ? 'GOOD' : 'POOR',
        conclusion: scaling > 5 ? 'SEVERE_CONTENTION' : 'ACCEPTABLE',
      })

      return { results, scaling, memoryScaling }
    }),
  )

  // Test 2.4: Memory pressure simulation
  createHypothesisTest(
    'H2.4-MemoryPressure',
    'Simulate memory pressure and measure impact',
    Effect.gen(function* () {
      yield* Effect.log('🧠 Testing under memory pressure...')

      // Check available memory
      const initialSnapshot = yield* collectSystemSnapshot
      const availableMB = Math.round(initialSnapshot.memory.available / 1024 / 1024)

      if (availableMB < 500) {
        yield* Effect.logWarning(`⚠️ Already low memory: ${availableMB}MB available`)
      }

      // Create memory pressure (if we have enough memory)
      const pressureSize = Math.min(availableMB * 0.3, 200) // Use 30% or 200MB max

      const { measurement } = yield* measureTiming(
        'test-under-memory-pressure',
        Effect.gen(function* () {
          // Create memory pressure
          const buffer = Buffer.alloc(pressureSize * 1024 * 1024, 'x')
          yield* Effect.log(`Created ${pressureSize}MB memory buffer`)

          // Now test Wrangler startup under pressure
          const server = yield* WranglerDevServerService
          yield* Effect.log(`Wrangler started under memory pressure on port ${server.port}`)

          // Keep buffer alive until end
          yield* Effect.sleep(Duration.seconds(1))
          buffer.fill(0) // Use buffer to prevent optimization

          return server.port
        }).pipe(
          Effect.provide(
            WranglerDevServerService.Default({
              cwd: `${import.meta.dirname}/fixtures`,
              showLogs: true,
            }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
          ),
          Effect.scoped,
        ),
      )

      const finalSnapshot = yield* collectSystemSnapshot

      yield* Effect.log('📊 Memory Pressure Analysis', {
        pressureApplied: `${pressureSize}MB`,
        initialAvailable: `${availableMB}MB`,
        finalAvailable: `${Math.round(finalSnapshot.memory.available / 1024 / 1024)}MB`,
        testDuration: `${measurement.durationMs}ms`,
        impact: measurement.durationMs > 10000 ? 'HIGH' : 'LOW',
      })

      return { measurement, pressureSize, initialSnapshot, finalSnapshot }
    }),
  )
})
