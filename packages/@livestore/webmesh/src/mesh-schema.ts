import { Schema, Transferable } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

const id = Schema.String.pipe(
  Schema.optional,
  Schema.withDefaults({ constructor: () => nanoid(10), decoding: () => nanoid(10) }),
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
 * Needs to go through already existing MessageChannel connections, times out otherwise
 *
 * Can't yet contain the `port` because the request might be duplicated while forwarding to multiple nodes.
 * We need a clear path back to the sender to avoid this, thus we respond with a separate
 * `MessageChannelResponseSuccess` which contains the `port`.
 */
export class MessageChannelRequest extends Schema.TaggedStruct('MessageChannelRequest', {
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

export class MessageChannelResponseSuccess extends Schema.TaggedStruct('MessageChannelResponseSuccess', {
  ...defaultPacketFields,
  reqId: Schema.String,
  port: Transferable.MessagePort,
  // Since we can't copy this message, we need to follow the exact route back to the sender
  remainingHops: Schema.Array(Schema.String),
  channelVersion: Schema.Number,
}) {}

export class MessageChannelResponseNoTransferables extends Schema.TaggedStruct(
  'MessageChannelResponseNoTransferables',
  {
    ...defaultPacketFields,
    reqId: Schema.String,
    remainingHops: Schema.Array(Schema.String),
  },
) {}

export class ProxyChannelRequest extends Schema.TaggedStruct('ProxyChannelRequest', {
  ...defaultPacketFields,
  remainingHops: remainingHopsUndefined,
  channelIdCandidate: Schema.String,
}) {}

export class ProxyChannelResponseSuccess extends Schema.TaggedStruct('ProxyChannelResponseSuccess', {
  ...defaultPacketFields,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  combinedChannelId: Schema.String,
  channelIdCandidate: Schema.String,
}) {}

export class ProxyChannelPayload extends Schema.TaggedStruct('ProxyChannelPayload', {
  ...defaultPacketFields,
  remainingHops: remainingHopsUndefined,
  payload: Schema.Any,
  combinedChannelId: Schema.String,
}) {}

export class ProxyChannelPayloadAck extends Schema.TaggedStruct('ProxyChannelPayloadAck', {
  ...defaultPacketFields,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  combinedChannelId: Schema.String,
}) {}

/**
 * Broadcast to all nodes when a new connection is added.
 * Mostly used for auto-reconnect purposes.
 */
export class NetworkConnectionAdded extends Schema.TaggedStruct('NetworkConnectionAdded', {
  id,
  source: Schema.String,
  target: Schema.String,
}) {}

export class NetworkConnectionTopologyRequest extends Schema.TaggedStruct('NetworkConnectionTopologyRequest', {
  id,
  hops: Schema.Array(Schema.String),
  /** Always fixed to who requested the topology */
  source: Schema.String,
  target: Schema.Literal('-'),
}) {}

export class NetworkConnectionTopologyResponse extends Schema.TaggedStruct('NetworkConnectionTopologyResponse', {
  id,
  reqId: Schema.String,
  remainingHops: Schema.Array(Schema.String),
  nodeName: Schema.String,
  connections: Schema.Array(Schema.String),
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

export class MessageChannelPacket extends Schema.Union(
  MessageChannelRequest,
  MessageChannelResponseSuccess,
  MessageChannelResponseNoTransferables,
) {}

export class ProxyChannelPacket extends Schema.Union(
  ProxyChannelRequest,
  ProxyChannelResponseSuccess,
  ProxyChannelPayload,
  ProxyChannelPayloadAck,
) {}

export class Packet extends Schema.Union(
  MessageChannelPacket,
  ProxyChannelPacket,
  NetworkConnectionAdded,
  NetworkConnectionTopologyRequest,
  NetworkConnectionTopologyResponse,
  BroadcastChannelPacket,
) {}

export class MessageChannelPing extends Schema.TaggedStruct('MessageChannelPing', {}) {}
export class MessageChannelPong extends Schema.TaggedStruct('MessageChannelPong', {}) {}
