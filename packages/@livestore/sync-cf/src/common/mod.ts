import { Schema } from '@livestore/utils/effect'

export { SyncHttpRpc } from './http-rpc-schema.ts'
export * as SyncMessage from './sync-message-types.ts'

export const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  payload: Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(Schema.JsonValue)).pipe(Schema.UndefinedOr),
})
