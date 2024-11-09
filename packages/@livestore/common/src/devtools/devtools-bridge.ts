import type { Effect, PubSub } from '@livestore/utils/effect'

import type * as Devtools from './devtools-messages.js'

export type PrepareDevtoolsBridge = {
  /** Messages coming from the app host (usually responses to requests) */
  responsePubSub: PubSub.PubSub<Devtools.MessageFromAppHostCoordinator | Devtools.MessageFromAppHostStore>
  sendToAppHost: (msg: Devtools.MessageToAppHostCoordinator | Devtools.MessageToAppHostStore) => Effect.Effect<void>
  appHostId: string
  copyToClipboard: (text: string) => Effect.Effect<void>
  sendEscapeKey?: Effect.Effect<void>
  isLeader: boolean
}
