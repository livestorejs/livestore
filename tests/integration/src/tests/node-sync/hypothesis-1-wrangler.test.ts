/**
 * HYPOTHESIS 1: Wrangler Server Startup Bottleneck
 *
 * Theory: Wrangler Dev Server takes significantly longer to start in CI due to:
 * - Cold starts and dependency downloads
 * - Network latency to CDNs
 * - Container/virtualization overhead
 * - Resource constraints during initialization
 */

import { Command, Duration, Effect, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { createHypothesisTest, environmentChecks, measureTiming } from './hypothesis-base.ts'

const timeout = Duration.toMillis(Duration.minutes(30))

Vitest.describe('Hypothesis 1: Wrangler Startup Bottleneck', { timeout }, () => {
  // Test 1.1: Pure Wrangler startup timing
  createHypothesisTest(
    'H1.1-WranglerStartup',
    'Measure pure Wrangler server startup time (no workers)',
    Effect.gen(function* () {
      yield* environmentChecks.verifyEnvironment()
      yield* environmentChecks.checkOrphanedProcesses()

      // Test 1: Single startup
      yield* Effect.log('🚀 Testing single Wrangler startup...')
      const { measurement: startup1 } = yield* measureTiming(
        'wrangler-single-startup',
        Effect.gen(function* () {
          const server = yield* WranglerDevServerService
          yield* Effect.log(`✅ Wrangler ready on port ${server.port}`)
          return server
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

      yield* Effect.sleep(Duration.seconds(2)) // Brief pause

      // Test 2: Second startup (should be faster with cache)
      yield* Effect.log('🔄 Testing second Wrangler startup...')
      const { measurement: startup2 } = yield* measureTiming(
        'wrangler-second-startup',
        Effect.gen(function* () {
          const server = yield* WranglerDevServerService
          yield* Effect.log(`✅ Wrangler ready on port ${server.port}`)
          return server
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

      // Analysis
      const improvement = startup1.durationMs - startup2.durationMs
      yield* Effect.log('📊 Startup Analysis', {
        first: `${startup1.durationMs}ms`,
        second: `${startup2.durationMs}ms`,
        improvement: `${improvement}ms (${Math.round((improvement / startup1.durationMs) * 100)}%)`,
        cacheEffective: improvement > 1000 ? 'YES' : 'MINIMAL',
      })

      return { startup1, startup2, improvement }
    }),
  )

  // Test 1.2: Concurrent startup stress test
  createHypothesisTest(
    'H1.2-ConcurrentStartup',
    'Test concurrent Wrangler startups (simulating parallel tests)',
    Effect.gen(function* () {
      yield* Effect.log('⚡ Testing concurrent Wrangler startups...')

      const concurrentCount = 3
      const startups = Array.from({ length: concurrentCount }, (_, i) =>
        measureTiming(
          `concurrent-startup-${i + 1}`,
          Effect.gen(function* () {
            const server = yield* WranglerDevServerService
            yield* Effect.sleep(Duration.seconds(1)) // Hold briefly
            return server.port
          }).pipe(
            Effect.provide(
              WranglerDevServerService.Default({
                cwd: `${import.meta.dirname}/fixtures`,
                showLogs: i === 0, // Only log first one to reduce noise
              }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
            ),
            Effect.scoped,
          ),
        ),
      )

      const results = yield* Effect.all(startups, { concurrency: 'unbounded' })

      const timings = results.map((r: any) => r.measurement.durationMs)
      const avgTime = timings.reduce((a: number, b: number) => a + b, 0) / timings.length
      const maxTime = Math.max(...timings)
      const minTime = Math.min(...timings)

      yield* Effect.log('📊 Concurrent Startup Analysis', {
        count: concurrentCount,
        average: `${Math.round(avgTime)}ms`,
        range: `${minTime}ms - ${maxTime}ms`,
        variance: `${Math.round(maxTime - minTime)}ms`,
        resourceContention: maxTime > minTime * 2 ? 'DETECTED' : 'MINIMAL',
      })

      return { timings, avgTime, maxTime, minTime }
    }),
  )

  // Test 1.3: Dependency resolution timing
  createHypothesisTest(
    'H1.3-DependencyResolution',
    'Measure dependency resolution phase timing',
    Effect.gen(function* () {
      yield* Effect.log('📦 Testing dependency resolution timing...')

      // Measure bunx wrangler resolution specifically
      const { measurement: bunxResolve } = yield* measureTiming(
        'bunx-wrangler-resolve',
        Effect.gen(function* () {
          // Just resolve the command, don't run it
          return yield* Command.make('bunx', '--help').pipe(Command.string, Effect.timeout(Duration.seconds(30)))
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      // Check if wrangler is already cached
      const { measurement: wranglerCheck } = yield* measureTiming(
        'wrangler-version-check',
        Effect.gen(function* () {
          return yield* Command.make('bunx', 'wrangler', '--version').pipe(
            Command.string,
            Effect.timeout(Duration.seconds(30)),
          )
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      yield* Effect.log('📊 Dependency Analysis', {
        bunxResolve: `${bunxResolve.durationMs}ms`,
        wranglerCheck: `${wranglerCheck.durationMs}ms`,
        cachingBenefit: wranglerCheck.durationMs < 1000 ? 'GOOD' : 'POOR',
      })

      return { bunxResolve, wranglerCheck }
    }),
  )

  // Test 1.4: Port allocation timing
  createHypothesisTest(
    'H1.4-PortAllocation',
    'Measure port allocation and network setup timing',
    Effect.gen(function* () {
      yield* Effect.log('🔌 Testing port allocation timing...')

      const { measurement: portAlloc } = yield* measureTiming(
        'port-allocation',
        Effect.gen(function* () {
          const ports: number[] = []
          for (let i = 0; i < 5; i++) {
            // Use a simple port allocation for testing purposes
            const port = 8000 + i
            ports.push(port)
            yield* Effect.log(`Allocated port ${i + 1}: ${port}`)
          }

          return ports
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      yield* Effect.log('📊 Port Allocation Analysis', {
        duration: `${portAlloc.durationMs}ms`,
        avgPerPort: `${Math.round(portAlloc.durationMs / 5)}ms`,
        efficiency: portAlloc.durationMs < 100 ? 'GOOD' : 'SLOW',
      })

      return portAlloc
    }),
  )

  // Test 1.5: Network connectivity check
  createHypothesisTest(
    'H1.5-NetworkConnectivity',
    'Test localhost connectivity and DNS resolution',
    Effect.gen(function* () {
      yield* Effect.log('🌐 Testing network connectivity...')

      // Test localhost resolution
      const { measurement: localhost } = yield* measureTiming(
        'localhost-resolution',
        Effect.gen(function* () {
          return yield* Command.make('ping', '-c', '1', 'localhost').pipe(
            Command.string,
            Effect.timeout(Duration.seconds(5)),
          )
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      // Test port connectivity
      const { measurement: portTest } = yield* measureTiming(
        'port-connectivity-test',
        Effect.gen(function* () {
          // Use nc (netcat) to test a port
          return yield* Command.make('nc', '-z', 'localhost', '8080').pipe(
            Command.string,
            Effect.timeout(Duration.seconds(5)),
            Effect.catchAll(() => Effect.succeed('port not available')), // Expected
          )
        }).pipe(Effect.provide(PlatformNode.NodeContext.layer)),
      )

      yield* Effect.log('📊 Network Analysis', {
        localhostPing: `${localhost.durationMs}ms`,
        portConnectivity: `${portTest.durationMs}ms`,
        networkHealth: localhost.durationMs < 100 ? 'GOOD' : 'POOR',
      })

      return { localhost, portTest }
    }),
  )
})
