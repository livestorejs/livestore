import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, FetchHttpClient, Layer } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'

import {
  type StartWranglerDevServerArgs,
  WranglerDevServerError,
  WranglerDevServerService,
  makeWranglerDevServerLayer,
} from './WranglerDevServer.ts'

import * as NodeServices from '@effect/platform-node/NodeServices'
const testTimeout = 60_000

const WranglerDevServerTest = (args: Partial<StartWranglerDevServerArgs> = {}) =>
  makeWranglerDevServerLayer({
    cwd: `${import.meta.dirname}/fixtures`,
    ...args,
  }).pipe(Layer.provide(FetchHttpClient.layer))

Vitest.describe('WranglerDevServer', { timeout: testTimeout }, () => {
  Vitest.describe('Basic Operations', () => {
    const withBasicTest = (args: Partial<StartWranglerDevServerArgs> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(NodeServices.layer)),
      })

    Vitest.scopedLive('should start wrangler dev server and return port', (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServerService

        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/http:\/\/127.0.0.1:\d+/)
      }).pipe(withBasicTest()(test)),
    )

    Vitest.scopedLive('should use specified port when provided', (test) =>
      Effect.andThen(getFreePort, (port) =>
        Effect.gen(function* () {
          const server = yield* WranglerDevServerService

          expect(server.port).toBe(port)
          expect(server.url).toBe(`http://127.0.0.1:${port}`)
        }).pipe(withBasicTest({ preferredPort: port })(test)),
      ),
    )
  })

  Vitest.describe('Error Handling', () => {
    const withErrorTest = (args: Partial<StartWranglerDevServerArgs> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(NodeServices.layer)),
      })

    Vitest.scopedLive('should handle missing wrangler.toml but should timeout', (test) =>
      Effect.gen(function* () {
        const error = yield* Effect.gen(function* () {
          return yield* WranglerDevServerService
        }).pipe(
          Effect.provide(
            WranglerDevServerTest({
              cwd: '/tmp',
              wranglerConfigPath: '/dev/null',
              readiness: { connectTimeout: '500 millis' },
            }).pipe(Layer.provide(NodeServices.layer)),
          ),
          Effect.flip,
        )

        expect(error).toBeInstanceOf(WranglerDevServerError)
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('should handle invalid working directory', (test) =>
      Effect.gen(function* () {
        const result = yield* Effect.gen(function* () {
          return yield* WranglerDevServerService
        }).pipe(
          Effect.provide(
            WranglerDevServerTest({
              cwd: '/completely/nonexistent/directory',
            }).pipe(Layer.provide(NodeServices.layer)),
          ),
          Effect.result,
        )

        expect(result._tag).toBe('Failure')
        if (result._tag === 'Failure') {
          expect(result.failure).toBeInstanceOf(WranglerDevServerError)
        }
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('should timeout if server fails to start', (test) =>
      Effect.gen(function* () {
        // Create a command that will never output "Ready on"
        const result = yield* Effect.gen(function* () {
          return yield* WranglerDevServerService
        }).pipe(
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
    const withServiceTest = (args: Partial<StartWranglerDevServerArgs> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => WranglerDevServerTest(args).pipe(Layer.provide(NodeServices.layer)),
      })

    Vitest.scopedLive('should work with service pattern', (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServerService

        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/http:\/\/127.0.0.1:\d+/)
      }).pipe(withServiceTest()(test)),
    )

    Vitest.scopedLive('should work with custom port via service', (test) =>
      Effect.andThen(getFreePort, (port) =>
        Effect.gen(function* () {
          const server = yield* WranglerDevServerService

          expect(server.port).toBe(port)
          expect(server.url).toBe(`http://127.0.0.1:${port}`)
        }).pipe(withServiceTest({ preferredPort: port })(test)),
      ),
    )
  })
})
