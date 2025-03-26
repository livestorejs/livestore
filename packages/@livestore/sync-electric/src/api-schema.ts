import { MutationEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PushPayload = Schema.TaggedStruct('@livestore/sync-electric.Push', {
  storeId: Schema.String,
  batch: Schema.Array(MutationEvent.AnyEncodedGlobal),
}).annotations({ title: '@livestore/sync-electric.PushPayload' })

export const PullPayload = Schema.TaggedStruct('@livestore/sync-electric.Pull', {
  storeId: Schema.String,
  handle: Schema.Option(
    Schema.Struct({
      offset: Schema.String,
      handle: Schema.String,
    }),
  ),
}).annotations({ title: '@livestore/sync-electric.PullPayload' })

export const ApiPayload = Schema.Union(PullPayload, PushPayload)
