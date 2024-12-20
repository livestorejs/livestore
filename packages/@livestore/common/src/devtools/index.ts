import type { Effect, Scope } from '@livestore/utils/effect'
import { Schema, WebChannel } from '@livestore/utils/effect'

export * from './devtools-messages.js'
export * from './devtools-window-message.js'
export * from './devtools-bridge.js'

export namespace WebBridge {
  export class AppHostReady extends Schema.TaggedStruct('LSD.WebBridge.AppHostReady', {
    appHostId: Schema.String,
    // storeId: Schema.String,
    isLeader: Schema.Boolean,
  }) {}

  export class DevtoolsReady extends Schema.TaggedStruct('LSD.WebBridge.DevtoolsReady', {
    devtoolsId: Schema.String,
  }) {}

  export class ConnectToDevtools extends Schema.TaggedStruct('LSD.WebBridge.ConnectToDevtools', {
    devtoolsId: Schema.String,
    appHostId: Schema.String,
    /**
     * Given the m:n relationship between devtools and app hosts and the fact that appHostIds are usually
     * sticky, we generate a new unique id for the lifetime of the web bridge.
     */
    webBridgeId: Schema.String,
    isLeader: Schema.Boolean,
    storeId: Schema.String,
  }) {}

  export class AppHostWillDisconnect extends Schema.TaggedStruct('LSD.WebBridge.AppHostWillDisconnect', {
    appHostId: Schema.String,
  }) {}

  // export class DevtoolsWillDisconnect extends Schema.TaggedStruct('LSD.WebBridge.DevtoolsWillDisconnect', {
  //   appHostId: Schema.String,
  // }) {}

  export class All extends Schema.Union(AppHostReady, DevtoolsReady, ConnectToDevtools, AppHostWillDisconnect) {}

  export const makeBroadcastChannel = (
    key?: string,
  ): Effect.Effect<WebChannel.WebChannel<typeof All.Type, typeof All.Type>, never, Scope.Scope> =>
    WebChannel.broadcastChannel({
      channelName: `livestore-web-bridge-devtools${key ? `-${key}` : ''}`,
      schema: All,
    })
}
