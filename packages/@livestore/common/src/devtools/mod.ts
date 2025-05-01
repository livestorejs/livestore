import type { Effect, Scope, WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import type { MeshNode } from '@livestore/webmesh'

import * as SessionInfo from './devtools-sessioninfo.js'

export * from './devtools-messages.js'
export * as SessionInfo from './devtools-sessioninfo.js'

export const DevtoolsMode = Schema.Union(
  Schema.TaggedStruct('node', {
    /** WebSocket URL */
    url: Schema.String,
  }),
  Schema.TaggedStruct('web', {}),
  Schema.TaggedStruct('browser-extension', {}),
)

export type DevtoolsMode = typeof DevtoolsMode.Type

export const DevtoolsModeTag = DevtoolsMode.pipe(Schema.pluck('_tag'), Schema.typeSchema)
export type DevtoolsModeTag = typeof DevtoolsModeTag.Type

export const makeNodeName = {
  devtools: {
    random: () => `devtools-session-info-${nanoid()}`,
  },
  client: {
    session: ({ storeId, clientId, sessionId }: { storeId: string; clientId: string; sessionId: string }) =>
      `client-session-${storeId}-${clientId}-${sessionId}`,
    leader: ({ storeId, clientId }: { storeId: string; clientId: string }) => `client-leader-${storeId}-${clientId}`,
  },
}

export const makeChannelName = {
  sessionInfo: () => `session-info`,
  devtoolsClientSession: ({ storeId, clientId, sessionId }: { storeId: string; clientId: string; sessionId: string }) =>
    `devtools-channel(client-session-${storeId}-${clientId}-${sessionId})`,
  devtoolsClientLeader: ({ storeId, clientId, sessionId }: { storeId: string; clientId: string; sessionId: string }) =>
    `devtools-channel(client-leader-${storeId}-${clientId}-${sessionId})`,
}

export const isChannelName = {
  devtoolsClientSession: (
    channelName: string,
    { storeId, clientId, sessionId }: { storeId: string; clientId: string; sessionId: string },
  ) => channelName === makeChannelName.devtoolsClientSession({ storeId, clientId, sessionId }),
  devtoolsClientLeader: (channelName: string, { storeId, clientId }: { storeId: string; clientId: string }) =>
    channelName.startsWith(`devtools-channel(client-leader-${storeId}-${clientId}`),
}

export const makeSessionInfoBroadcastChannel = (
  webmeshNode: MeshNode,
): Effect.Effect<WebChannel.WebChannel<SessionInfo.Message, SessionInfo.Message>, never, Scope.Scope> =>
  webmeshNode.makeBroadcastChannel({
    channelName: makeChannelName.sessionInfo(),
    schema: SessionInfo.Message,
  })
