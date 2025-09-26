import { type CommandExecutor, Effect, type PlatformError } from '@livestore/utils/effect'
import type { DockerComposeError } from '@livestore/utils-dev/node'
import { providerKeys, providerRegistry } from './providers/registry.ts'

// Meant to separate test preparation from test execution (e.g. pulling docker images)
export const prepareCi: Effect.Effect<
  void,
  PlatformError.PlatformError | DockerComposeError,
  CommandExecutor.CommandExecutor
> = Effect.gen(function* () {
  yield* Effect.log('Preparing sync provider tests')

  // Prepare all providers (note: many are Effect.void and complete instantly)
  yield* Effect.forEach(providerKeys, (key) => providerRegistry[key].prepare, { concurrency: 'unbounded' })

  yield* Effect.log('Sync provider tests prepared')
}).pipe(Effect.withSpan('prepare-ci'))
