import type { Effect, PubSub } from '@livestore/utils/effect'

import type * as Devtools from './devtools-messages.js'

export type PrepareDevtoolsBridge = {
  /** Messages coming from the app host (usually responses to requests) */
  responsePubSub: PubSub.PubSub<Devtools.MessageFromAppLeader | Devtools.MessageFromAppClientSession>
  sendToAppHost: (msg: Devtools.MessageToAppLeader | Devtools.MessageToAppClientSession) => Effect.Effect<void>
  clientId: string
  sessionId: string
  copyToClipboard: (text: string) => Effect.Effect<void>
  sendEscapeKey?: Effect.Effect<void>
  isLeader: boolean
}
