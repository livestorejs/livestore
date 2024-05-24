import { Schema } from '@livestore/utils/effect'

import { mutationEventSchemaEncodedAny } from '../../schema/mutations.js'

export const Broadcast = Schema.Struct({
  _tag: Schema.Literal('BC.Broadcast'),
  sender: Schema.Literal('leader-worker', 'ui-thread'),
  ref: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
})

export type Broadcast = typeof Broadcast.Type

export const Message = Schema.Union(Broadcast)
export type Message = typeof Message.Type
