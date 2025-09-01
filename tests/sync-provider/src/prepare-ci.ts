import { type CommandExecutor, Effect, type PlatformError } from '@livestore/utils/effect'
import type { DockerComposeError } from '@livestore/utils-dev/node'
import * as CloudflareDoRpc from './providers/cloudflare-do-rpc.ts'
import * as CloudflareHttpRpc from './providers/cloudflare-http-rpc.ts'
import * as CloudflareWs from './providers/cloudflare-ws.ts'
import * as Electric from './providers/electric.ts'

// Meant to separate test preparation from test execution (e.g. pulling docker images)
export const prepareCi: Effect.Effect<
  void,
  PlatformError.PlatformError | DockerComposeError,
  CommandExecutor.CommandExecutor
> = Effect.gen(function* () {
  yield* Effect.log('Preparing sync provider tests')

  yield* Effect.all([Electric.prepare, CloudflareWs.prepare, CloudflareHttpRpc.prepare, CloudflareDoRpc.prepare], {
    concurrency: 'unbounded',
  })

  yield* Effect.log('Sync provider tests prepared')
}).pipe(Effect.withSpan('prepare-ci'))
