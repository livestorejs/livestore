import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeWsSync } from '@livestore/sync-cf'
import { Effect } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

const argv = getWorkerArgs()

makeWorkerEffect({
  sync: {
    makeBackend: ({ storeId }) => makeWsSync({ url: 'ws://localhost:8787', storeId }),
  },
}).pipe(Effect.provide(OtelLiveHttp({ serviceName: `cli-worker-${argv.storeId}`, skipLogUrl: true })), Effect.runFork)
