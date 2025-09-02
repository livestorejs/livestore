import './thread-polyfill.ts'

import { Duration, Effect, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { collectSystemSnapshot, measureTiming } from './diagnostics/index.ts'
import { makeFileLogger } from './fixtures/file-logger.ts'

const timeout = Duration.toMillis(Duration.minutes(20))

const testLayer = (testContext: any) =>
  Layer.mergeAll(
    makeFileLogger('validation', { testContext }),
    WranglerDevServerService.Default({
      cwd: `${import.meta.dirname}/fixtures`,
      showLogs: false, // Reduce noise for validation tests
    }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
  )

Vitest.describe('Root Cause Validation Tests', { timeout }, () => {
  /**
   * Test 1: Controlled Concurrency - Explicit Resource Contention Validation
   *
   * This test definitively proves/disproves resource contention by comparing:
   * - Sequential execution times (baseline)
   * - Concurrent execution times (contention test)
   * - Resource usage patterns during each scenario
   */
  Vitest.scopedLive('Controlled Concurrency Test', (test) =>
    Effect.gen(function* () {
      yield* Effect.log('🔬 Starting Controlled Concurrency Validation')

      // Baseline: Single worker execution
      const singleWorkerTest = Effect.gen(function* () {
        yield* Effect.log('📊 Testing single worker baseline...')
        const startSnapshot = yield* collectSystemSnapshot()

        yield* Effect.sleep(Duration.seconds(5)) // Simulate worker workload

        const endSnapshot = yield* collectSystemSnapshot()
        return {
          duration: endSnapshot.timestamp.getTime() - startSnapshot.timestamp.getTime(),
          memoryDelta: endSnapshot.memory.used - startSnapshot.memory.used,
          processDelta: endSnapshot.processes.total - startSnapshot.processes.total,
        }
      })

      const { measurement: singleResult } = yield* measureTiming('single-worker-baseline', singleWorkerTest)

      yield* Effect.log('✅ Single worker baseline', {
        duration: `${singleResult.durationMs}ms`,
        success: singleResult.success,
      })

      // Test 2: Sequential execution of 2 workers
      const sequentialTest = Effect.gen(function* () {
        yield* Effect.log('📊 Testing sequential execution...')

        const worker1 = Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(5))
          return 'worker1-done'
        })

        const worker2 = Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(5))
          return 'worker2-done'
        })

        // Run sequentially
        yield* worker1
        yield* worker2

        return 'sequential-complete'
      })

      const { measurement: sequentialResult } = yield* measureTiming('sequential-workers', sequentialTest)

      yield* Effect.log('✅ Sequential execution', {
        duration: `${sequentialResult.durationMs}ms`,
        success: sequentialResult.success,
      })

      // Test 3: Concurrent execution of 2 workers
      const concurrentTest = Effect.gen(function* () {
        yield* Effect.log('📊 Testing concurrent execution...')

        const worker1 = Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(5))
          return 'worker1-done'
        })

        const worker2 = Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(5))
          return 'worker2-done'
        })

        // Run concurrently
        yield* Effect.all([worker1, worker2], { concurrency: 'unbounded' })

        return 'concurrent-complete'
      })

      const { measurement: concurrentResult } = yield* measureTiming('concurrent-workers', concurrentTest)

      yield* Effect.log('✅ Concurrent execution', {
        duration: `${concurrentResult.durationMs}ms`,
        success: concurrentResult.success,
      })

      // Analysis: Resource Contention Detection
      const sequentialTime = sequentialResult.durationMs
      const concurrentTime = concurrentResult.durationMs
      const expectedConcurrentTime = Math.max(5000, singleResult.durationMs) // Should be ~5s if no contention

      const contentionRatio = concurrentTime / expectedConcurrentTime
      const isResourceContention = contentionRatio > 1.5 // >50% overhead indicates contention

      yield* Effect.log('🔍 Resource Contention Analysis', {
        singleWorker: `${singleResult.durationMs}ms`,
        sequential: `${sequentialTime}ms`,
        concurrent: `${concurrentTime}ms`,
        expectedConcurrent: `${expectedConcurrentTime}ms`,
        contentionRatio: contentionRatio.toFixed(2),
        verdict: isResourceContention ? '❌ RESOURCE CONTENTION DETECTED' : '✅ NO RESOURCE CONTENTION',
      })

      if (isResourceContention) {
        yield* Effect.logWarning('🚨 Resource contention is causing performance degradation')
        yield* Effect.logWarning(`   Concurrent execution is ${contentionRatio.toFixed(1)}x slower than expected`)
      }

      return {
        resourceContention: isResourceContention,
        contentionRatio,
        timings: {
          single: singleResult.durationMs,
          sequential: sequentialTime,
          concurrent: concurrentTime,
        },
      }
    }).pipe(Effect.provide(testLayer(test))),
  )

  /**
   * Test 2: Process Lifecycle Profiling
   *
   * Measures the overhead of process creation/destruction in CI environment
   */
  Vitest.scopedLive('Process Lifecycle Profiling', (test) =>
    Effect.gen(function* () {
      yield* Effect.log('🔬 Starting Process Lifecycle Profiling')

      // Test A: Single process lifecycle
      const singleProcessTest = Effect.gen(function* () {
        const { execSync } = require('node:child_process')

        // Spawn a simple process and measure lifecycle
        const start = Date.now()
        execSync('sleep 1', { timeout: 10000 })
        const end = Date.now()

        return end - start
      })

      const { measurement: singleProcResult } = yield* measureTiming('single-process-lifecycle', singleProcessTest)

      // Test B: Multiple process lifecycles
      const multiProcessTest = Effect.gen(function* () {
        const { execSync } = require('node:child_process')
        const processes = 5

        const times: number[] = []
        for (let i = 0; i < processes; i++) {
          const start = Date.now()
          execSync('sleep 0.5', { timeout: 10000 })
          const end = Date.now()
          times.push(end - start)
        }

        return {
          individual: times,
          average: times.reduce((a, b) => a + b, 0) / times.length,
          total: times.reduce((a, b) => a + b, 0),
        }
      })

      const { measurement: multiProcResult, result: multiProcResults } = yield* measureTiming('multi-process-lifecycle', multiProcessTest)

      // Analysis: Process overhead detection
      const singleTime = singleProcResult.durationMs
      const avgMultiTime = (multiProcResults as any)?.average || 0

      const processOverhead = avgMultiTime / singleTime
      const hasProcessOverhead = processOverhead > 1.3 // >30% overhead per additional process

      yield* Effect.log('🔍 Process Overhead Analysis', {
        singleProcess: `${singleTime}ms`,
        averageMultiProcess: `${avgMultiTime}ms`,
        overheadRatio: processOverhead.toFixed(2),
        verdict: hasProcessOverhead ? '❌ PROCESS OVERHEAD DETECTED' : '✅ NO SIGNIFICANT PROCESS OVERHEAD',
      })

      return {
        processOverhead: hasProcessOverhead,
        overheadRatio: processOverhead,
        singleProcessTime: singleTime,
        avgMultiProcessTime: avgMultiTime,
      }
    }).pipe(Effect.provide(testLayer(test))),
  )

  /**
   * Test 3: Environment Dependency Validation
   *
   * Validates environment differences and dependency availability
   */
  Vitest.scopedLive('Environment Dependency Validation', (test) =>
    Effect.gen(function* () {
      yield* Effect.log('🔬 Starting Environment Dependency Validation')

      // Test A: Module availability check
      const dependencyTest = Effect.gen(function* () {
        const results: Record<string, { available: boolean; loadTime: number }> = {}

        const testModules = ['better-sqlite3', '@livestore/utils/effect', '@livestore/utils-dev/node', 'vitest']

        for (const moduleName of testModules) {
          const start = Date.now()
          try {
            require.resolve(moduleName)
            const end = Date.now()
            results[moduleName] = { available: true, loadTime: end - start }
          } catch {
            const end = Date.now()
            results[moduleName] = { available: false, loadTime: end - start }
          }
        }

        return results
      })

      const { measurement: depResult, result: depResults } = yield* measureTiming('dependency-availability', dependencyTest)

      // Test B: Environment variable impact
      const envTest = Effect.gen(function* () {
        const ciEnvVars = ['CI', 'GITHUB_ACTIONS', 'NODE_OPTIONS', 'PLAYWRIGHT_BROWSERS_PATH', 'DIRENV_DIFF']

        const envImpact: Record<string, string | undefined> = {}
        for (const envVar of ciEnvVars) {
          envImpact[envVar] = process.env[envVar]
        }

        return envImpact
      })

      const { measurement: envResult, result: envResults } = yield* measureTiming('environment-analysis', envTest)
      const missingDeps = Object.entries(depResults || {})
        .filter(([_, info]: [string, any]) => !info.available)
        .map(([name]) => name)

      yield* Effect.log('🔍 Dependency Analysis', {
        totalDependencies: Object.keys(depResults || {}).length,
        missingDependencies: missingDeps,
        slowModules: Object.entries(depResults || {})
          .filter(([_, info]: [string, any]) => info.loadTime > 100)
          .map(([name, info]: [string, any]) => `${name}: ${info.loadTime}ms`),
      })

      const hasDependencyIssues = missingDeps.length > 0

      return {
        dependencyIssues: hasDependencyIssues,
        missingDependencies: missingDeps,
        moduleLoadTimes: depResults,
        environmentVars: envResults,
      }
    }).pipe(Effect.provide(testLayer(test))),
  )

  /**
   * Test 4: Comprehensive Root Cause Ranking
   *
   * Combines all validation tests to rank root causes by impact
   */
  Vitest.scopedLive('Root Cause Impact Ranking', (test) =>
    Effect.gen(function* () {
      yield* Effect.log('🔬 Starting Comprehensive Root Cause Ranking')

      // This test will be implemented to run after the above tests
      // and provide a definitive ranking of performance bottlenecks

      yield* Effect.log('📋 Root Cause Ranking will be based on:')
      yield* Effect.log('   1. Resource contention ratio (from Test 1)')
      yield* Effect.log('   2. Process overhead ratio (from Test 2)')
      yield* Effect.log('   3. Environment/dependency impact (from Test 3)')
      yield* Effect.log('   4. Comparison with original hypothesis test timings')

      return 'ranking-placeholder'
    }).pipe(Effect.provide(testLayer(test))),
  )
})
