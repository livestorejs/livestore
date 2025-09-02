import { omitUndefineds } from '@livestore/utils'
import { type Effect, Predicate, Schema } from '@livestore/utils/effect'

import type { DirectChannelPacket, Packet, ProxyChannelPacket } from './mesh-schema.ts'

export type ProxyQueueItem = {
  packet: typeof ProxyChannelPacket.Type
  respondToSender: (msg: typeof ProxyChannelPacket.Type) => Effect.Effect<void>
}

export type MessageQueueItem = {
  packet: typeof DirectChannelPacket.Type
  respondToSender: (msg: typeof DirectChannelPacket.Type) => Effect.Effect<void>
}

export type MeshNodeName = string

export type ChannelName = string
export type ChannelKey = `target:${MeshNodeName}, channelName:${ChannelName}`

// TODO actually use this to avoid timeouts in certain cases
// export class NoConnectionRouteSignal extends Schema.TaggedError<NoConnectionRouteSignal>()(
//   'NoConnectionRouteSignal',
//   {},
// ) {}

export class EdgeAlreadyExistsError extends Schema.TaggedError<EdgeAlreadyExistsError>()('EdgeAlreadyExistsError', {
  target: Schema.String,
}) {}

export const packetAsOtelAttributes = (packet: typeof Packet.Type) => ({
  packetId: packet.id,
  'span.label':
    packet.id + (Predicate.hasProperty(packet, 'reqId') && packet.reqId !== undefined ? ` for ${packet.reqId}` : ''),
  ...omitUndefineds({
    packet:
      packet._tag !== 'DirectChannelResponseSuccess' && packet._tag !== 'ProxyChannelPayload' ? packet : undefined,
  }),
})

export const ListenForChannelResult = Schema.Struct({
  channelName: Schema.String,
  source: Schema.String,
  mode: Schema.Union(Schema.Literal('proxy'), Schema.Literal('direct')),
})

export type ListenForChannelResult = typeof ListenForChannelResult.Type
