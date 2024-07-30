import { BrowserChannel, Schema } from '@livestore/utils/effect'

export * from './devtools-messages.js'
export * from './devtools-window-message.js'

export namespace WebBridge {
  export const makeBroadcastChannel = (key?: string) =>
    BrowserChannel.broadcastChannel({
      channelName: `livestore-web-bridge-devtools${key ? `-${key}` : ''}`,
      listenSchema: Schema.Never,
      sendSchema: Schema.Never,
    })
}
