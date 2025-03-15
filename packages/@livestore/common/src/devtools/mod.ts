import { Schema } from '@livestore/utils/effect'

export * from './devtools-messages.js'
export * from './devtools-window-message.js'
export * as SessionInfo from './devtools-sessioninfo.js'
export const ClientSessionInfo = Schema.Struct({
  storeId: Schema.String,
  clientId: Schema.String,
  sessionId: Schema.String,
})

export const DevtoolsMode = Schema.Union(
  Schema.TaggedStruct('expo', {
    // TODO get rid of embedded `clientSessionInfo`
    clientSessionInfo: Schema.optional(ClientSessionInfo),
  }),
  // TODO add storeId, clientId and sessionId for Node
  Schema.TaggedStruct('node', {
    // TODO get rid of embedded `clientSessionInfo`
    clientSessionInfo: Schema.UndefinedOr(ClientSessionInfo),
    url: Schema.String,
  }),
  Schema.TaggedStruct('web', {
    // TODO get rid of embedded `clientSessionInfo`
    clientSessionInfo: Schema.UndefinedOr(ClientSessionInfo),
  }),
  Schema.TaggedStruct('browser-extension', {
    // TODO get rid of embedded `clientSessionInfo`
    clientSessionInfo: Schema.UndefinedOr(ClientSessionInfo),
  }),
)

export type DevtoolsMode = typeof DevtoolsMode.Type

export const DevtoolsModeTag = DevtoolsMode.pipe(Schema.pluck('_tag'), Schema.typeSchema)
export type DevtoolsModeTag = typeof DevtoolsModeTag.Type
