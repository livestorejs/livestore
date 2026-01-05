import { RpcSerialization } from '@livestore/utils/effect'
import type { SerializationFormat } from '../../common/mod.ts'

/**
 * Creates the serialization layer based on the configured format.
 * JSON is the default, MessagePack is opt-in for better performance.
 */
export const makeSerializationLayer = (format: SerializationFormat = 'json') => {
  switch (format) {
    case 'json':
      return RpcSerialization.layerJson
    case 'msgpack':
      return RpcSerialization.layerMsgPack
    default:
      return RpcSerialization.layerJson
  }
}

/**
 * JSON serialization layer (default).
 * Human-readable, widely compatible, good for debugging.
 */
export const JsonSerializationLayer = RpcSerialization.layerJson

/**
 * MessagePack serialization layer (opt-in).
 * Binary format, more compact, better performance for large payloads.
 */
export const MsgPackSerializationLayer = RpcSerialization.layerMsgPack
