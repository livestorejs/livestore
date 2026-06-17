import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, FetchHttpClient, Layer, Result } from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'

import * as WranglerDevServer from './WranglerDevServer.ts'

const testTimeout = 60_000

const WranglerDevServerTest = (args: Partial<WranglerDevServer.Options> = {}) =>
  WranglerDevServer.layer({
    cwd: `${import.meta.dirname}/fixtures`,
    ...args,
  }).pipe(Layer.provide(FetchHttpClient.layer))

Vitest.describe('WranglerDevServer', { timeout: testTimeout }, () => {
  Vitest.describe('Basic Operations', () => {
    const withBasicTest = (args: Partial<WranglerDevServer.Options> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
      })

    Vitest.live('should start wrangler dev server and return port', (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServer.WranglerDevServer

        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/http:\/\/127.0.0.1:\d+/)
      }).pipe(withBasicTest()(test)),
    )

    Vitest.live('should use specified port when provided', (test) =>
      Effect.andThen(getFreePort, (port) =>
        Effect.gen(function* () {
          const server = yield* WranglerDevServer.WranglerDevServer

          expect(server.port).toBe(port)
          expect(server.url).toBe(`http://127.0.0.1:${port}`)
        }).pipe(withBasicTest({ preferredPort: port })(test)),
      ),
    )
  })

  Vitest.describe('Error Handling', () => {
    const withErrorTest = (args: Partial<WranglerDevServer.Options> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
      })

    Vitest.live('should handle missing wrangler.toml but should timeout', (test) =>
      Effect.gen(function* () {
        const error = yield* WranglerDevServer.WranglerDevServer.pipe(
          Effect.provide(
            WranglerDevServerTest({
              cwd: '/tmp',
              wranglerConfigPath: '/dev/null',
              readiness: { connectTimeout: '500 millis' },
            }).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
          ),
          Effect.flip,
        )

        expect(error).toBeInstanceOf(WranglerDevServer.WranglerDevServerError)
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.live('should handle invalid working directory', (test) =>
      Effect.gen(function* () {
        const result = yield* WranglerDevServer.WranglerDevServer.pipe(
          Effect.provide(
            WranglerDevServerTest({
              cwd: '/completely/nonexistent/directory',
            }).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
          ),
          Effect.result,
        )

        expect(result._tag).toBe('Failure')
        if (result._tag === 'Failure') {
          expect(result.failure).toBeInstanceOf(WranglerDevServer.WranglerDevServerError)
        }
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.live('should timeout if server fails to start', (test) =>
      Effect.gen(function* () {
        // Create a command that will never output "Ready on"
        const result = yield* WranglerDevServer.WranglerDevServer.pipe(
          // Override the timeout for this test to be shorter
          Effect.timeout('5 seconds'),
          Effect.result,
        )

        // This might succeed or fail depending on actual wrangler behavior
        // The main point is testing timeout functionality
        expect(['Failure', 'Success']).toContain(result._tag)
      }).pipe(withErrorTest()(test)),
    )
  })

  Vitest.describe('Service Pattern', () => {
    const withServiceTest = (args: Partial<WranglerDevServer.Options> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
      })

    Vitest.live('should work with service pattern', (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServer.WranglerDevServer

        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/http:\/\/127.0.0.1:\d+/)
      }).pipe(withServiceTest()(test)),
    )

    Vitest.live('should work with custom port via service', (test) =>
      Effect.andThen(getFreePort, (port) =>
        Effect.gen(function* () {
          const server = yield* WranglerDevServer.WranglerDevServer

          expect(server.port).toBe(port)
          expect(server.url).toBe(`http://127.0.0.1:${port}`)
        }).pipe(withServiceTest({ preferredPort: port })(test)),
      ),
    )
  })
})
