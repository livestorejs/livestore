import path from 'node:path'

import { expect } from 'vite-plus/test'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Duration, Effect, Layer, Stream } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import * as DockerCompose from './DockerCompose.ts'

const testTimeout = 30_000
const testFixturePath = path.join(import.meta.dirname, 'test-fixtures')

const DockerComposeTest = (args: Partial<DockerCompose.Options> = {}) =>
  DockerCompose.layer({
    cwd: testFixturePath,
    ...args,
  })

Vitest.describe('DockerCompose', { timeout: testTimeout }, () => {
  Vitest.describe('Basic Operations', () => {
    const withBasicTest = (args: Partial<DockerCompose.Options> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => DockerComposeTest(args).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
      })

    Vitest.live('can pull docker images', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerCompose.DockerCompose

        // Test that pull operation works (should succeed for hello-world image)
        yield* dockerCompose.pull
      }).pipe(withBasicTest()(test)),
    )

    Vitest.live('can start and stop docker compose services', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerCompose.DockerCompose

        // Start the service
        yield* dockerCompose.start({ detached: true })

        // Stop the service
        yield* dockerCompose.stop
      }).pipe(withBasicTest({ serviceName: 'hello-world' })(test)),
    )

    Vitest.live('can get logs from docker compose services', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerCompose.DockerCompose

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
    const withHealthCheckTest = (args: Partial<DockerCompose.Options> = {}) =>
      Vitest.makeWithTestCtx({
        timeout: testTimeout,
        makeLayer: () => DockerComposeTest(args).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
      })

    Vitest.live('handles health check timeout gracefully', (test) =>
      Effect.gen(function* () {
        const dockerCompose = yield* DockerCompose.DockerCompose

        // Test starting with a health check that will timeout (invalid URL)
        const result = yield* dockerCompose
          .start({
            detached: true,
            healthCheck: {
              url: 'http://localhost:99999/nonexistent',
              timeout: Duration.seconds(2),
            },
          })
          .pipe(Effect.result)

        // Should fail due to health check timeout
        expect(result._tag).toBe('Failure')
      }).pipe(withHealthCheckTest({ serviceName: 'hello-world' })(test)),
    )
  })
})
