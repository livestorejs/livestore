import { Schema } from '@livestore/utils/effect'

import { mutationEventSchemaEncodedAny } from '../schema/mutations.js'

// TODO introduce req/ack
export const Broadcast = Schema.TaggedStruct('BC.Broadcast', {
  sender: Schema.Literal('leader-worker', 'follower-thread'),
  ref: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export type Broadcast = typeof Broadcast.Type

export const Message = Schema.Union(Broadcast)
export type Message = typeof Message.Type
