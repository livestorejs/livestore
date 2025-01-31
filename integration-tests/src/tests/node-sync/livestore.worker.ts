import { getWorkerArgs, makeWorkerEffect } from '@livestore/node/worker'
import { makeWsSync } from '@livestore/sync-cf'
import { Effect } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

const argv = getWorkerArgs()

makeWorkerEffect({
  sync: {
    makeBackend: ({ storeId }) => makeWsSync({ url: 'ws://localhost:8888/websocket', storeId }),
  },
}).pipe(
  Effect.provide(OtelLiveHttp({ serviceName: `node-sync-test:livestore-leader-${argv.clientId}`, skipLogUrl: true })),
  Effect.runFork,
)
