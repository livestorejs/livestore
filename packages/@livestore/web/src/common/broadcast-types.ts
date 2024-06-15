import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

// TODO introduce req/ack
export const Broadcast = Schema.TaggedStruct('BC.Broadcast', {
  sender: Schema.Literal('leader-worker', 'ui-thread'),
  ref: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export type Broadcast = typeof Broadcast.Type

export const Message = Schema.Union(Broadcast)
export type Message = typeof Message.Type
