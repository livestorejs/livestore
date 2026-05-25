import { OversizeChunkItemError, splitChunkBySize } from '@livestore/common/sync'
import { Schema } from '@livestore/utils/effect'

export type { CfTypes } from '@livestore/common-cf'
export * from './constants.ts'
export { SyncHttpRpc } from './http-rpc-schema.ts'
export * as SyncMessage from './sync-message-types.ts'
export { OversizeChunkItemError, splitChunkBySize }

export const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  /**
   * `Schema.optional` (not `UndefinedOr`) because `UrlParams.fromInput` drops undefined values on
   * encode, so the URL never carries the `payload` key when no payload is supplied. A required key
   * (even one that allows `undefined`) would then fail to decode round-trip on the server.
   */
  payload: Schema.optional(
    Schema.decodeTo(Schema.fromJsonString(Schema.JsonValue))(Schema.StringFromUriComponent) as any,
  ),
  // NOTE `do-rpc` is handled differently
  transport: Schema.Literals(['http', 'ws']),
})

export type SearchParams = typeof SearchParamsSchema.Type
