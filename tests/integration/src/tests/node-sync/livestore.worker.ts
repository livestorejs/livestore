import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeWsSync } from '@livestore/sync-cf'
import { IS_CI } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { OtelLiveDummy, OtelLiveHttp } from '@livestore/utils/node'

const argv = getWorkerArgs()

makeWorkerEffect({
  sync: {
    makeBackend: ({ storeId }) => makeWsSync({ url: `ws://localhost:${process.env.LIVESTORE_SYNC_PORT}`, storeId }),
  },
}).pipe(
  Effect.provide(
    IS_CI
      ? OtelLiveDummy
      : OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true }),
  ),
  Effect.runFork,
)
