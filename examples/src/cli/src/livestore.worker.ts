import { getWorkerArgs, makeWorkerEffect } from '@livestore/adapter-node/worker'
import { makeCfSync } from '@livestore/sync-cf'
import { Effect } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

const argv = getWorkerArgs()

makeWorkerEffect({
  sync: {
    backend: makeCfSync({ url: 'ws://localhost:8787' }),
  },
}).pipe(Effect.provide(OtelLiveHttp({ serviceName: `cli-worker-${argv.storeId}`, skipLogUrl: true })), Effect.runFork)
