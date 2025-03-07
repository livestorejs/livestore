import { Devtools } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'

import { makeChannelForConnectedMeshNode, makeNodeDevtoolsConnectedMeshNode } from '../web-channel/index.js'

export const prepareNodeDevtoolsBridge = ({
  url,
  storeId,
  clientId,
  sessionId,
}: {
  url: string
  storeId: string
  clientId: string
  sessionId: string
}): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
  Effect.gen(function* () {
    const meshNode = yield* makeNodeDevtoolsConnectedMeshNode({ nodeName: `devtools`, url })

    const isLeader = true // For now we only support a single node instance, which always is the leader

    // TODO maybe we need a temporary channel to create a unique bridge channel e..g see appHostInfoDeferred below
    const nodeDevtoolsChannelStore = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `client-session-${storeId}-${clientId}-${sessionId}`,
      schema: {
        listen: Devtools.ClientSession.MessageFromApp,
        send: Devtools.ClientSession.MessageToApp,
      },
    })

    const nodeDevtoolsChannelCoordinator = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `leader-${storeId}-${clientId}`,
      schema: {
        listen: Devtools.Leader.MessageFromApp,
        send: Devtools.Leader.MessageToApp,
      },
    })

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      webchannels: {
        leader: nodeDevtoolsChannelCoordinator,
        clientSession: nodeDevtoolsChannelStore,
      },
      clientInfo: { clientId, sessionId, isLeader },
      copyToClipboard,
    } satisfies Devtools.PrepareDevtoolsBridge
  }).pipe(Effect.orDie)
