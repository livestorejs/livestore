import { Schema } from '@livestore/utils/effect'

export * as WSMessage from './ws-message-types.ts'

export const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  payload: Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(Schema.JsonValue)).pipe(Schema.UndefinedOr),
})
