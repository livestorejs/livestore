import type { Effect, Scope, WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import type { MeshNode } from '@livestore/webmesh'

import * as SessionInfo from './devtools-sessioninfo.ts'

export * from './devtools-messages.ts'
export * as SessionInfo from './devtools-sessioninfo.ts'

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
    random: () => `devtools-instance-${nanoid()}`,
  },
  client: {
    session: ({ storeId, clientId, sessionId }: { storeId: string; clientId: string; sessionId: string }) =>
      `client-session-${storeId}-${clientId}-${sessionId}`,
    leader: ({ storeId, clientId }: { storeId: string; clientId: string }) => `client-leader-${storeId}-${clientId}`,
  },
}

export const makeChannelName = {
  /**
   * SessionInfo channel for DevTools discovery.
   * When an `origin` is provided, it is incorporated into the channel name to scope
   * broadcasts per origin (e.g. `session-info::http%3A%2F%2Flocalhost%3A5173`).
   * The `origin` is currently required only for the browser extension path; non‑browser
   * publishers can pass `undefined` to use the legacy global channel name.
   */
  sessionInfo: ({ origin }: { origin: string | undefined }) =>
    origin ? `session-info::${encodeURIComponent(origin)}` : `session-info`,
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
  options: { origin: string | undefined },
): Effect.Effect<WebChannel.WebChannel<SessionInfo.Message, SessionInfo.Message>, never, Scope.Scope> =>
  webmeshNode.makeBroadcastChannel({
    channelName: makeChannelName.sessionInfo({ origin: options?.origin }),
    schema: SessionInfo.Message,
  })
