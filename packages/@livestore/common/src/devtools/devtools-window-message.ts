import { Schema, Transferable } from '@livestore/utils/effect'

const appHostId = Schema.String

export namespace DevtoolsWindowMessage {
  /** Message is being created in contentscript-iframe, sent to contentscript and then sent to Store */
  export class MessagePortReady extends Schema.TaggedStruct('LSD.WindowMessage.MessagePortReady', {
    port: Transferable.MessagePort,
    appHostId,
  }) {}

  export class ContentscriptListening extends Schema.TaggedStruct('LSD.WindowMessage.ContentscriptListening', {}) {}

  // export class ContentscriptReady extends Schema.TaggedStruct('LSD.WindowMessage.ContentscriptReady', {
  // 	appHostId,
  // }) {}

  export class LoadIframe extends Schema.TaggedStruct('LSD.WindowMessage.LoadIframe', {}) {}

  export class StoreReady extends Schema.TaggedStruct('LSD.WindowMessage.StoreReady', {
    appHostId,
  }) {}

  export class MessageForStore extends Schema.Union(MessagePortReady, ContentscriptListening) {}

  export class MessageForContentscript extends Schema.Union(StoreReady, LoadIframe) {}
}
