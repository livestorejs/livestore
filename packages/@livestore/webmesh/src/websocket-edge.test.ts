/**
 * Tests for websocket-edge.ts
 *
 * These tests verify basic WebSocket edge functionality.
 */

import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Either, Schema, WebChannel } from '@livestore/utils/effect'

import * as MeshSchema from './mesh-schema.ts'
import { MessageMsgPack, WSEdgeInit, WSEdgePayload } from './websocket-edge.ts'

Vitest.describe('websocket-edge', () => {
  /**
   * Test that WSEdgeInit messages can be encoded/decoded via MessageMsgPack.
   */
  Vitest.scopedLive('should encode/decode WSEdgeInit', (test) =>
    Effect.gen(function* () {
      const initMessage = WSEdgeInit.make({ from: 'test-node' })

      // Encode to msgpack
      const encoded = yield* Schema.encode(MessageMsgPack)(initMessage)

      // Decode back
      const decoded = yield* Schema.decode(MessageMsgPack)(encoded)

      expect(decoded._tag).toBe('WSEdgeInit')
      if (decoded._tag === 'WSEdgeInit') {
        expect(decoded.from).toBe('test-node')
      }
    }).pipe(Vitest.withTestCtx(test)),
  )

  /**
   * Test that WSEdgePayload messages with valid Packet payloads work correctly.
   */
  Vitest.scopedLive('should encode/decode WSEdgePayload with Packet', (test) =>
    Effect.gen(function* () {
      const packet = {
        _tag: 'NetworkEdgeAdded' as const,
        id: 'test-id',
        source: 'node-a',
        target: 'node-b',
      }
      const wsMessage = WSEdgePayload.make({ from: 'test-node', payload: packet })

      // Encode to msgpack
      const encoded = yield* Schema.encode(MessageMsgPack)(wsMessage)

      // Decode back
      const decoded = yield* Schema.decode(MessageMsgPack)(encoded)

      expect(decoded._tag).toBe('WSEdgePayload')
      if (decoded._tag === 'WSEdgePayload') {
        expect(decoded.from).toBe('test-node')
        expect(decoded.payload).toEqual(packet)
      }
    }).pipe(Vitest.withTestCtx(test)),
  )

  /**
   * Test that mapSchema(Packet) includes WebChannel internal messages.
   * This is important because channels can send/receive WebChannel.Ping/Pong/DebugPing.
   */
  Vitest.scopedLive('mapSchema should include WebChannel messages in schema', (test) =>
    Effect.gen(function* () {
      const schema = WebChannel.mapSchema(MeshSchema.Packet)

      // WebChannel.Ping should be decodable via the wrapped listen schema
      const pingPayload = { _tag: 'WebChannel.Ping' as const, requestId: 'test-123' }
      const result = Schema.decodeUnknownEither(schema.listen)(pingPayload)

      // mapSchema adds WebChannel messages to the schema
      expect(Either.isRight(result)).toBe(true)
    }).pipe(Vitest.withTestCtx(test)),
  )

  /**
   * Test that valid webmesh packets can be decoded.
   */
  Vitest.scopedLive('should decode valid webmesh packets', (test) =>
    Effect.gen(function* () {
      const schema = WebChannel.mapSchema(MeshSchema.Packet)

      const packet = {
        _tag: 'NetworkEdgeAdded' as const,
        id: 'test-id',
        source: 'node-a',
        target: 'node-b',
      }

      const result = yield* Schema.decodeUnknown(schema.listen)(packet)
      expect(result._tag).toBe('NetworkEdgeAdded')
    }).pipe(Vitest.withTestCtx(test)),
  )
})
