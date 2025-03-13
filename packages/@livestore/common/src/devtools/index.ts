import { Schema } from '@livestore/utils/effect'

export * from './devtools-messages.js'
export * from './devtools-window-message.js'

export const DevtoolsMode = Schema.Union(
  Schema.TaggedStruct('from-search-params', {}),
  Schema.TaggedStruct('expo', {
    storeId: Schema.String,
    clientId: Schema.String,
    sessionId: Schema.String,
  }),
  // TODO add storeId, clientId and sessionId for Node
  Schema.TaggedStruct('node', {
    storeId: Schema.String,
    clientId: Schema.String,
    sessionId: Schema.String,
    url: Schema.String,
  }),
  Schema.TaggedStruct('web', {
    storeId: Schema.String,
    clientId: Schema.String,
    sessionId: Schema.String,
  }),
  Schema.TaggedStruct('browser-extension', {
    storeId: Schema.String,
    clientId: Schema.String,
    sessionId: Schema.String,
  }),
)

export type DevtoolsMode = typeof DevtoolsMode.Type
