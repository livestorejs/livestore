import { OversizeChunkItemError, splitChunkBySize } from '@livestore/common/sync'
import { Schema } from '@livestore/utils/effect'

export type { CfTypes } from '@livestore/common-cf'
export * from './constants.ts'
export { SyncHttpRpc } from './http-rpc-schema.ts'
export * as SyncMessage from './sync-message-types.ts'
export { OversizeChunkItemError, splitChunkBySize }

export const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  payload: Schema.decodeEffectTo(Schema.StringFromUriComponent, Schema.fromJsonString(Schema.Json)).pipe(
    Schema.UndefinedOr,
  ),
  // NOTE `do-rpc` is handled differently
  transport: Schema.Literals(['http', 'ws']),
})

export type SearchParams = typeof SearchParamsSchema.Type
