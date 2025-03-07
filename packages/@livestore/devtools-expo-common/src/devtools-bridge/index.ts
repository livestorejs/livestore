import { Devtools } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'

import { makeChannelForConnectedMeshNode, makeExpoDevtoolsConnectedMeshNode } from '../web-channel/index.js'

// TODO use a unique bridgeId for each connection (similar to web bridge)
export const prepareExpoDevtoolsBridge = ({
  storeId,
  clientId,
  sessionId,
}: {
  storeId: string
  clientId: string
  sessionId: string
}): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
  Effect.gen(function* () {
    const target = `expo-${storeId}-${clientId}-${sessionId}`
    const meshNode = yield* makeExpoDevtoolsConnectedMeshNode({
      nodeName: `devtools-${storeId}-${clientId}-${sessionId}`,
      target,
    })

    // @ts-expect-error typing
    globalThis.__debugWebMeshNode = meshNode

    const isLeader = true // TODO properly implement this

    // TODO maybe we need a temporary channel to create a unique bridge channel e..g see appHostInfoDeferred below
    const expoDevtoolsChannelClientSession = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target,
      schema: {
        listen: Devtools.ClientSession.MessageFromApp,
        send: Devtools.ClientSession.MessageToApp,
      },
      channelType: 'clientSession',
    })

    const expoDevtoolsChannelLeader = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target,
      schema: { listen: Devtools.Leader.MessageFromApp, send: Devtools.Leader.MessageToApp },
      channelType: 'leader',
    })

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      webchannels: {
        leader: expoDevtoolsChannelLeader,
        clientSession: expoDevtoolsChannelClientSession,
      },
      clientInfo: { clientId, sessionId, isLeader },
      copyToClipboard,
    } satisfies Devtools.PrepareDevtoolsBridge
  }).pipe(Effect.orDie)
