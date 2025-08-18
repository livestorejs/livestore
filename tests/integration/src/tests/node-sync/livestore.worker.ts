import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeCfSync } from '@livestore/sync-cf/client'
import { IS_CI } from '@livestore/utils'
import { Effect, Layer } from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { makeFileLogger } from './fixtures/file-logger.ts'
import { schema } from './schema.ts'

const argv = getWorkerArgs()

const layer = Layer.mergeAll(
  IS_CI
    ? OtelLiveDummy
    : OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true }),
  makeFileLogger(`livestore-worker-${argv.clientId}`),
)

makeWorkerEffect({
  sync: {
    backend: makeCfSync({ url: `ws://localhost:${process.env.LIVESTORE_SYNC_PORT}` }),
  },
  schema,
}).pipe(Effect.provide(layer), PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }))
