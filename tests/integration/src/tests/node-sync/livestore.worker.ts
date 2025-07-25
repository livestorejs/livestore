import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeCfSync } from '@livestore/sync-cf'
import { IS_CI } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { makeFileLogger } from './fixtures/file-logger.ts'
import { schema } from './schema.ts'

const argv = getWorkerArgs()

makeWorkerEffect({
  sync: {
    backend: makeCfSync({ url: `ws://localhost:${process.env.LIVESTORE_SYNC_PORT}` }),
  },
  schema,
}).pipe(
  Effect.provide(
    IS_CI
      ? OtelLiveDummy
      : OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true }),
  ),
  Effect.provide(makeFileLogger(`livestore-worker-${argv.clientId}`)),
  PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }),
)
