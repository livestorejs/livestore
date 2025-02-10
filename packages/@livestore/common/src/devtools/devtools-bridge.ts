import type { Effect, WebChannel } from '@livestore/utils/effect'

import type * as Devtools from './devtools-messages.js'

export type PrepareDevtoolsBridge = {
  webchannels: {
    leader: WebChannel.WebChannel<Devtools.Leader.MessageFromApp, Devtools.Leader.MessageToApp>
    clientSession: WebChannel.WebChannel<Devtools.ClientSession.MessageFromApp, Devtools.ClientSession.MessageToApp>
  }
  clientInfo: {
    clientId: string
    sessionId: string
    isLeader: boolean
  }
  copyToClipboard: (text: string) => Effect.Effect<void>
  sendEscapeKey?: Effect.Effect<void>
}
