import { Effect, Schema, Transferable } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

const id = Schema.String.pipe(
  Schema.optionalKey,
  Schema.withConstructorDefault(Effect.sync(() => nanoid(10))),
  Schema.withDecodingDefaultType(Effect.sync(() => nanoid(10))),
)

const defaultPacketFields = {
  id,
  target: Schema.String,
  source: Schema.String,
  channelName: Schema.String,
  hops: Schema.Array(Schema.String),
}

const remainingHopsUndefined = Schema.Undefined.pipe(Schema.optional)

/**
 * Needs to go through already existing DirectChannel edges, times out otherwise
 *
 * Can't yet contain the `port` because the request might be duplicated while forwarding to multiple nodes.
 * We need a clear path back to the sender to avoid this, thus we respond with a separate
 * `DirectChannelResponseSuccess` which contains the `port`.
 */
export class DirectChannelRequest extends Schema.TaggedClass<DirectChannelRequest>()('DirectChannelRequest', {
  ...defaultPacketFields,
  remainingHops: Schema.Array(Schema.String).pipe(Schema.optional),
  channelVersion: Schema.Number,
  /** Only set if the request is in response to an incoming request */
  reqId: Schema.UndefinedOr(Schema.String),
  /**
   * Additionally to the `source` field, we use this field to track whether the instance of a
   * source has changed.
   */
  sourceId: Schema.String,
}) {}

export class DirectChannelResponseSuccess extends Schema.TaggedClass<DirectChannelResponseSuccess>()('DirectChannelResponseSuccess', {
  ...defaultPacketFields,
  reqId: Schema.String,
  port: Transferable.MessagePort,
  // Since we can't copy this message, we need to follow the exact route back to the sender
  remainingHops: Schema.Array(Schema.String),
  channelVersion: Schema.Number,
}) {}

export class DirectChannelResponseNoTransferables extends Schema.TaggedClass<DirectChannelResponseNoTransferables>()('DirectChannelResponseNoTransferables', {
  ...defaultPacketFields,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
}) {}

export class ProxyChannelRequest extends Schema.TaggedClass<ProxyChannelRequest>()('ProxyChannelRequest', {
  ...defaultPacketFields,
  remainingHops: remainingHopsUndefined,
  channelIdCandidate: Schema.String,
}) {}

export class ProxyChannelResponseSuccess extends Schema.TaggedClass<ProxyChannelResponseSuccess>()('ProxyChannelResponseSuccess', {
  ...defaultPacketFields,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  combinedChannelId: Schema.String,
  channelIdCandidate: Schema.String,
}) {}

export class ProxyChannelPayload extends Schema.TaggedClass<ProxyChannelPayload>()('ProxyChannelPayload', {
  ...defaultPacketFields,
  remainingHops: remainingHopsUndefined,
  payload: Schema.Any,
  combinedChannelId: Schema.String,
}) {}

export class ProxyChannelPayloadAck extends Schema.TaggedClass<ProxyChannelPayloadAck>()('ProxyChannelPayloadAck', {
  ...defaultPacketFields,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  combinedChannelId: Schema.String,
}) {}

/**
 * Broadcast to all nodes when a new edge is added.
 * Mostly used for auto-reconnect purposes.
 */
export class NetworkEdgeAdded extends Schema.TaggedClass<NetworkEdgeAdded>()('NetworkEdgeAdded', {
  id,
  source: Schema.String,
  target: Schema.String,
}) {}

export class NetworkTopologyRequest extends Schema.TaggedClass<NetworkTopologyRequest>()('NetworkTopologyRequest', {
  id,
  hops: Schema.Array(Schema.String),
  /** Always fixed to who requested the topology */
  source: Schema.String,
  target: Schema.Literal('-'),
}) {}

export class NetworkTopologyResponse extends Schema.TaggedClass<NetworkTopologyResponse>()('NetworkTopologyResponse', {
  id,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  nodeName: Schema.String,
  edges: Schema.Array(Schema.String),
  /** Always fixed to who requested the topology */
  source: Schema.String,
  target: Schema.Literal('-'),
}) {}

export const BroadcastChannelPacket = Schema.TaggedStruct('BroadcastChannelPacket', {
  id,
  channelName: Schema.String,
  /**
   * The payload is expected to be encoded/decoded by the send/listen schema.
   * Transferables are not supported.
   */
  payload: Schema.Any,
  hops: Schema.Array(Schema.String),
  source: Schema.String,
  target: Schema.Literal('-'),
})

export const DirectChannelPacket = Schema.Union([
  DirectChannelRequest,
  DirectChannelResponseSuccess,
  DirectChannelResponseNoTransferables,
])
export type DirectChannelPacket = typeof DirectChannelPacket.Type

export const ProxyChannelPacket = Schema.Union([
  ProxyChannelRequest,
  ProxyChannelResponseSuccess,
  ProxyChannelPayload,
  ProxyChannelPayloadAck,
])
export type ProxyChannelPacket = typeof ProxyChannelPacket.Type

export const Packet = Schema.Union([
  DirectChannelPacket,
  ProxyChannelPacket,
  NetworkEdgeAdded,
  NetworkTopologyRequest,
  NetworkTopologyResponse,
  BroadcastChannelPacket,
])
export type Packet = typeof Packet.Type

export class DirectChannelPing extends Schema.TaggedClass<DirectChannelPing>()('DirectChannelPing', {}) {}
export class DirectChannelPong extends Schema.TaggedClass<DirectChannelPong>()('DirectChannelPong', {}) {}
