import type { Effect, Scope } from '@livestore/utils/effect'
import { BrowserChannel, Schema } from '@livestore/utils/effect'

export * from './devtools-messages.js'
export * from './devtools-window-message.js'

export namespace WebBridge {
  export class AppHostReady extends Schema.TaggedStruct('LSD.WebBridge.AppHostReady', {
    channelId: Schema.String,
  }) {}

  export class DevtoolsReady extends Schema.TaggedStruct('LSD.WebBridge.DevtoolsReady', {}) {}

  export class AppHostWillDisconnect extends Schema.TaggedStruct('LSD.WebBridge.AppHostWillDisconnect', {
    channelId: Schema.String,
  }) {}

  // export class DevtoolsWillDisconnect extends Schema.TaggedStruct('LSD.WebBridge.DevtoolsWillDisconnect', {
  //   channelId: Schema.String,
  // }) {}

  export class All extends Schema.Union(AppHostReady, DevtoolsReady, AppHostWillDisconnect) {}

  export const makeBroadcastChannel = (
    key?: string,
  ): Effect.Effect<BrowserChannel.BrowserChannel<typeof All.Type, typeof All.Type>, never, Scope.Scope> =>
    BrowserChannel.broadcastChannel({
      channelName: `livestore-web-bridge-devtools${key ? `-${key}` : ''}`,
      listenSchema: All,
      sendSchema: All,
    })
}
