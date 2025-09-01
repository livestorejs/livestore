import path from 'node:path'
import { Duration, Effect, Layer, Stream } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { type DockerComposeArgs, DockerComposeService } from './DockerComposeService.ts'

const testTimeout = 30_000
const testFixturePath = path.join(import.meta.dirname, 'test-fixtures')

const DockerComposeTest = (args: Partial<DockerComposeArgs> = {}) =>
  DockerComposeService.Default({
    cwd: testFixturePath,
    ...args,
  })

Vitest.describe('DockerComposeService', { timeout: testTimeout }, () => {
  Vitest.describe('Basic Operations', () => {
    const withBasicTest = (args: Partial<DockerComposeArgs> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => DockerComposeTest(args).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
      })

    Vitest.scopedLive('can pull docker images', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerComposeService

        // Test that pull operation works (should succeed for hello-world image)
        yield* dockerCompose.pull
      }).pipe(withBasicTest()(test)),
    )

    Vitest.scopedLive('can start and stop docker compose services', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerComposeService

        // Start the service
        yield* dockerCompose.start({ detached: true })

        // Stop the service
        yield* dockerCompose.stop
      }).pipe(withBasicTest({ serviceName: 'hello-world' })(test)),
    )

    Vitest.scopedLive('can get logs from docker compose services', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerComposeService

        // Start the service first
        yield* dockerCompose.start({ detached: true })

        // Get logs (should contain at least the "Hello from Docker!" message)
        const firstLogLine = yield* dockerCompose.logs().pipe(Stream.runHead)

        expect(firstLogLine._tag).toBe('Some')

        // Stop the service
        yield* dockerCompose.stop
      }).pipe(withBasicTest({ serviceName: 'hello-world' })(test)),
    )
  })

  Vitest.describe('Health Check Operations', () => {
    const withHealthCheckTest = (args: Partial<DockerComposeArgs> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => DockerComposeTest(args).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
      })

    Vitest.scopedLive('handles health check timeout gracefully', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerComposeService

        // Test starting with a health check that will timeout (invalid URL)
        const result = yield* dockerCompose
          .start({
            detached: true,
            healthCheck: {
              url: 'http://localhost:99999/nonexistent',
              timeout: Duration.seconds(2),
            },
          })
          .pipe(Effect.either)

        // Should fail due to health check timeout
        expect(result._tag).toBe('Left')
      }).pipe(withHealthCheckTest({ serviceName: 'hello-world' })(test)),
    )
  })
})
