/**
 * HYPOTHESIS 3: Network & Port Allocation Issues
 *
 * Theory: CI environment has network restrictions causing timeouts:
 * - Port allocation conflicts or delays
 * - DNS resolution issues
 * - Firewall or container networking restrictions
 * - Localhost connectivity problems
 * - Network interface configuration issues
 */

import { Command, Duration, Effect, Layer } from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { createHypothesisTest, environmentChecks, measureTiming } from './hypothesis-base.ts'

const timeout = Duration.toMillis(Duration.minutes(30))

Vitest.describe('Hypothesis 3: Network & Port Issues', { timeout }, () => {
  // Test 3.1: Port allocation performance
  createHypothesisTest(
    'H3.1-PortAllocation',
    'Measure port allocation speed and conflicts',
    Effect.gen(function* () {
      yield* environmentChecks.verifyEnvironment

      yield* Effect.log('🔌 Testing port allocation performance...')

      const portCount = 10
      const allocatedPorts = []
      const timings = []

      for (let i = 0; i < portCount; i++) {
        const { measurement } = yield* measureTiming(`port-allocation-${i + 1}`, getFreePort, { attempt: i + 1 }).pipe(
          Effect.provide(PlatformNode.NodeContext.layer),
        )

        timings.push(measurement.durationMs)
        if (measurement.success) {
          allocatedPorts.push((measurement as any).result)
        }
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length
      const maxTime = Math.max(...timings)
      const minTime = Math.min(...timings)

      yield* Effect.log('📊 Port Allocation Analysis', {
        successfulAllocations: allocatedPorts.length,
        averageTime: `${Math.round(avgTime)}ms`,
        range: `${minTime}ms - ${maxTime}ms`,
        efficiency: avgTime < 10 ? 'EXCELLENT' : avgTime < 50 ? 'GOOD' : 'POOR',
        portRange:
          allocatedPorts.length > 0 ? `${Math.min(...allocatedPorts)} - ${Math.max(...allocatedPorts)}` : 'none',
      })

      return { timings, allocatedPorts, avgTime }
    }),
  )

  // Test 3.2: DNS and localhost resolution
  createHypothesisTest(
    'H3.2-DNSResolution',
    'Test DNS resolution and localhost connectivity',
    Effect.gen(function* () {
      yield* Effect.log('🌐 Testing DNS resolution and localhost connectivity...')

      const tests = [
        { name: 'localhost-ping', command: ['ping', '-c', '1', '-W', '1000', 'localhost'] },
        { name: 'localhost-nslookup', command: ['nslookup', 'localhost'] },
        { name: '127.0.0.1-ping', command: ['ping', '-c', '1', '-W', '1000', '127.0.0.1'] },
      ]

      const results = []

      for (const test of tests) {
        const { measurement } = yield* measureTiming(
          test.name,
          Command.make(...test.command).pipe(
            Command.stdout('string'),
            Effect.timeout(Duration.seconds(10)),
            Effect.catchAll((error) => Effect.succeed(`FAILED: ${error}`)),
          ),
        ).pipe(Effect.provide(PlatformNode.NodeContext.layer))

        results.push({ ...test, measurement })

        yield* Effect.log(`${test.name}: ${measurement.durationMs}ms (${measurement.success ? 'OK' : 'FAILED'})`)
      }

      const avgDnsTime = results.reduce((sum, r) => sum + r.measurement.durationMs, 0) / results.length
      const failures = results.filter((r) => !r.measurement.success).length

      yield* Effect.log('📊 DNS/Connectivity Analysis', {
        averageResolutionTime: `${Math.round(avgDnsTime)}ms`,
        failures: `${failures}/${results.length}`,
        networkHealth: failures === 0 && avgDnsTime < 100 ? 'EXCELLENT' : failures === 0 ? 'GOOD' : 'POOR',
      })

      return { results, avgDnsTime, failures }
    }),
  )

  // Test 3.3: Port binding and server startup
  createHypothesisTest(
    'H3.3-PortBinding',
    'Test actual port binding and HTTP server startup',
    Effect.gen(function* () {
      yield* Effect.log('🚀 Testing port binding and server startup...')

      const port = yield* getFreePort.pipe(Effect.provide(PlatformNode.NodeContext.layer))

      yield* Effect.log(`Testing with port ${port}`)

      const { measurement } = yield* measureTiming(
        'http-server-startup',
        Effect.gen(function* () {
          // Start a simple HTTP server to test port binding
          const { createServer } = yield* Effect.promise(() => import('node:http'))

          return yield* Effect.async<number>((resume) => {
            const server = createServer((_req, res) => {
              res.writeHead(200, { 'Content-Type': 'text/plain' })
              res.end('OK')
            })

            server.listen(port, 'localhost', () => {
              // Test connection to self
              const http = require('node:http')
              const req = http.request(`http://localhost:${port}`, (_res: any) => {
                server.close(() => {
                  resume(Effect.succeed(port))
                })
              })

              req.on('error', (error: any) => {
                server.close(() => {
                  resume(Effect.fail(error))
                })
              })

              req.end()
            })

            server.on('error', (error) => {
              resume(Effect.fail(error))
            })
          })
        }),
      )

      yield* Effect.log('📊 Port Binding Analysis', {
        port: port,
        bindingTime: `${measurement.durationMs}ms`,
        success: measurement.success,
        performance: measurement.durationMs < 100 ? 'EXCELLENT' : measurement.durationMs < 500 ? 'GOOD' : 'POOR',
      })

      return { measurement, port }
    }),
  )

  // Test 3.4: Wrangler network performance
  createHypothesisTest(
    'H3.4-WranglerNetworking',
    'Test Wrangler-specific networking performance',
    Effect.gen(function* () {
      yield* Effect.log('🔧 Testing Wrangler networking performance...')

      // Test multiple Wrangler instances on different ports
      const instanceCount = 3
      const results = []

      for (let i = 0; i < instanceCount; i++) {
        yield* Effect.log(`Starting Wrangler instance ${i + 1}/${instanceCount}...`)

        const { measurement } = yield* measureTiming(
          `wrangler-instance-${i + 1}`,
          Effect.gen(function* () {
            const server = yield* WranglerDevServerService

            // Test actual HTTP connectivity
            const testUrl = `${server.url}/health`
            const { HttpClient } = yield* Effect.serviceConstants(PlatformNode.NodeContext)

            // Give server a moment to be fully ready
            yield* Effect.sleep(Duration.seconds(1))

            // Test HTTP request (might fail, that's OK)
            const response = yield* HttpClient.request.get(testUrl).pipe(
              Effect.timeout(Duration.seconds(5)),
              Effect.catchAll(() => Effect.succeed('connection-test-failed')),
            )

            return { port: server.port, response }
          }).pipe(
            Effect.provide(
              WranglerDevServerService.Default({
                cwd: `${import.meta.dirname}/fixtures`,
                showLogs: i === 0, // Only log first instance
              }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
            ),
            Effect.scoped,
          ),
        )

        results.push(measurement)

        yield* Effect.log(`Instance ${i + 1}: ${measurement.durationMs}ms (${measurement.success ? 'OK' : 'FAILED'})`)

        // Brief pause between instances
        yield* Effect.sleep(Duration.seconds(2))
      }

      const avgStartupTime = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
      const successCount = results.filter((r) => r.success).length

      yield* Effect.log('📊 Wrangler Networking Analysis', {
        instancesTested: instanceCount,
        successRate: `${successCount}/${instanceCount}`,
        averageStartup: `${Math.round(avgStartupTime)}ms`,
        networkStability: successCount === instanceCount ? 'STABLE' : 'UNSTABLE',
        performance: avgStartupTime < 5000 ? 'GOOD' : 'POOR',
      })

      return { results, avgStartupTime, successCount }
    }),
  )
})
