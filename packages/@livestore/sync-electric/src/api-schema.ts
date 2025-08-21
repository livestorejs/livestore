import { LiveStoreEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PushPayload = Schema.TaggedStruct('@livestore/sync-electric.Push', {
  storeId: Schema.String,
  batch: Schema.Array(LiveStoreEvent.AnyEncodedGlobal),
}).annotations({ title: '@livestore/sync-electric.PushPayload' })

export const PullPayload = Schema.TaggedStruct('@livestore/sync-electric.Pull', {
  storeId: Schema.String,
  payload: Schema.UndefinedOr(Schema.JsonValue),
  handle: Schema.Option(
    Schema.Struct({
      offset: Schema.String,
      handle: Schema.String,
    }),
  ),
  live: Schema.Boolean,
}).annotations({ title: '@livestore/sync-electric.PullPayload' })

export const ApiPayload = Schema.Union(PullPayload, PushPayload)

// Format for the query params
export const ArgsSchema = Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(PullPayload))
