import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { NodeRuntime } from '@effect/platform-node'
import { makeWsSync } from '@livestore/sync-cf/client'
import { IS_CI } from '@livestore/utils'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Effect, Layer } from '@livestore/utils/effect'
import { OtelLiveDummy } from '@livestore/utils/node'

import { makeFileLogger } from './fixtures/file-logger.ts'
import { schema } from './schema.ts'

const argv = getWorkerArgs()
const syncUrl = (argv.extraArgs as { syncUrl: string }).syncUrl

const layer = Layer.mergeAll(
  IS_CI === true
    ? OtelLiveDummy
    : OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true }),
  makeFileLogger(`livestore-worker-${argv.clientId}`),
)

makeWorkerEffect({
  sync: { backend: makeWsSync({ url: syncUrl }) },
  schema,
}).pipe(Effect.provide(layer), NodeRuntime.runMain)
