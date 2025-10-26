import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeWsSync } from '@livestore/sync-cf/client'
import { IS_CI } from '@livestore/utils'
import { Effect, Layer } from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { makeFileLogger } from './fixtures/file-logger.ts'
import { schema } from './schema.ts'

const argv = getWorkerArgs()
const syncUrl = (argv.extraArgs as { syncUrl: string }).syncUrl

const layer = Layer.mergeAll(
  IS_CI
    ? OtelLiveDummy
    : OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true }),
  makeFileLogger(`livestore-worker-${argv.clientId}`),
)

makeWorkerEffect({
  sync: { backend: makeWsSync({ url: syncUrl }) },
  schema,
}).pipe(Effect.provide(layer), PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }))
