import { Devtools } from '@livestore/common'
import { Schema, Transferable } from '@livestore/utils/effect'

export namespace BackgroundMessage {
  export class CopyToClipboard extends Schema.TaggedStruct('Background.CopyToClipboard', {
    text: Schema.String,
  }) {}

  export class MessageFromAppHost extends Schema.TaggedStruct('Background.MessageFromAppHost', {
    msg: Devtools.MessageFromAppLeader,
  }) {}

  export class MessageToAppHost extends Schema.TaggedStruct('Background.MessageToAppHost', {
    msg: Devtools.MessageToAppLeader,
  }) {}

  export class RequestPortForDevtools extends Schema.TaggedStruct('Background.RequestPortForDevtools', {
    tabId: Schema.Number,
  }) {}

  export class RequestOneTimePortFromDevtools extends Schema.TaggedStruct('Background.RequestOneTimePortFromDevtools', {
    tabId: Schema.Number,
  }) {}

  export class Disconnect extends Schema.TaggedStruct('Background.Disconnect', { appHostId: Schema.String }) {}
}

export namespace MessagePortInit {
  /**
   * Message is first sent from contentscript-iframe to background and then posted to the devtools.
   */
  export class PortForDevtools extends Schema.TaggedStruct('MessagePortInit.PortForDevtools', {
    port: Transferable.MessagePort,
    tabId: Schema.Number,
    appHostId: Schema.String,
  }) {}

  export class OneTimePortFromDevtools extends Schema.TaggedStruct('MessagePortInit.OneTimePortFromDevtools', {
    port: Transferable.MessagePort,
    tabId: Schema.Number,
  }) {}
}
