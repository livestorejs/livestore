import {
  Effect,
  Fiber,
  FiberMap,
  Layer,
  RpcClient,
  type RpcMessage,
  RpcSerialization,
  type Scope,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'

/**
 * Processes a ReadableStream response from streaming RPCs.
 * Drains the entire stream into a single buffer, then decodes it once and writes
 * the decoded messages as RPC responses.
 *
 * Why drain-first instead of decode-per-chunk: Cloudflare DO RPC splits the
 * stream's bytes into arbitrary read chunks (~4KB on miniflare) that do not
 * align with msgpack frame boundaries, so a chunk frequently ends mid-frame.
 *
 * `RpcSerialization.msgPack`'s decoder is stateful (it stashes an `incomplete`
 * tail from `unpackMultiple` and prepends it on the next `decode()` call), so in
 * a standard JS runtime decode-per-chunk usually reassembles straddling frames.
 * However, in the Cloudflare Workers (workerd) runtime this in-process recovery
 * was observed to fail for multi-chunk catchup payloads: the decoder yielded a
 * truncated/garbage result, which fails schema validation downstream and throws
 * out of the read loop, aborting every further `reader.read()` and silently
 * abandoning the rest of the stream (the client only ever sees the first chunk's
 * worth of messages). See the do-rpc stream-stall handoff for details.
 *
 * Draining first guarantees the decoder is always handed complete msgpack
 * frames in a single call, which removes the dependency on the stateful
 * incomplete-recovery path entirely.
 *
 * Exported for testing.
 */
export const processReadableStream = (
  stream: CfTypes.ReadableStream,
  parser: ReturnType<typeof RpcSerialization.msgPack.unsafeMake>,
  writeResponse: (response: any) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reader = stream.getReader()

    yield* Effect.gen(function* () {
      // Drain the full stream into one buffer BEFORE decoding (see jsdoc above).
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read()).pipe(Effect.orDie)

        if (done === true) {
          break
        }

        const chunk = value as Uint8Array
        chunks.push(chunk)
        totalBytes += chunk.byteLength
      }

      // Concatenate all chunks into a single contiguous buffer.
      const combined = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
      }

      // Decode the complete buffer once.
      const decoded = parser.decode(combined)

      // Handle array of messages from server.
      // Server sends `parser.encode([message])` per enqueue, so each decoded value is `[message]`.
      // When CF DO RPC merges enqueues in production, we get `[[msg1], [msg2], ...]`.
      // `flat(1)` normalizes both single and merged cases to `[msg1, msg2, ...]`.
      let messages: any[]
      if (Array.isArray(decoded) === true) {
        messages = decoded.flat(1)
      } else {
        messages = [decoded]
      }

      // Write each message
      for (const message of messages) {
        yield* writeResponse(message)
      }
    }).pipe(
      Effect.withSpan('do-rpc-client:processReadableStream'),
      Effect.ensuring(
        Effect.promise(() => reader.cancel()).pipe(Effect.andThen(() => Effect.sync(() => reader.releaseLock()))),
      ),
    )
  })

interface MakeDoRpcProtocolArgs {
  callRpc: (payload: Uint8Array) => Promise<Uint8Array | CfTypes.ReadableStream>
  callerContext: {
    bindingName: string
    durableObjectId: string
  }
}

/**
 * Creates a Protocol layer that uses Cloudflare Durable Object RPC calls.
 * This enables direct RPC communication with Durable Objects using Cloudflare's native RPC.
 */
export const layerProtocolDurableObject = (
  args: MakeDoRpcProtocolArgs,
): Layer.Layer<RpcClient.Protocol> => Layer.scoped(RpcClient.Protocol, makeProtocolDurableObject(args))

/**
 * Implementation of the RPC Protocol interface using Cloudflare Durable Object RPC calls.
 * Provides the core protocol methods required by @effect/rpc.
 */
const makeProtocolDurableObject = ({
  callRpc,
}: MakeDoRpcProtocolArgs): Effect.Effect<RpcClient.Protocol['Type'], never, Scope.Scope> =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse) {
      const parser = RpcSerialization.msgPack.unsafeMake()
      // Not using an actual `FiberMap` here because it seems to shutdown to early
      // const fiberMap = new Map<string, Fiber.RuntimeFiber<void, never>>()
      const fiberMap = yield* FiberMap.make<string, void, never>()

  const send = (message: RpcMessage.FromClientEncoded): Effect.Effect<void> => {
        if (message._tag !== 'Request') {
          if (message._tag === 'Interrupt') {
            return Effect.gen(function* () {
              const fiber = yield* FiberMap.get(fiberMap, message.requestId)
              yield* Fiber.interrupt(fiber)
            }).pipe(Effect.orDie)
          }

          return Effect.void
        }

        // Wrap single Request in array to match server expected format
        const serializedPayload = parser.encode([message]) as Uint8Array

        return Effect.gen(function* () {
          const serializedResponse = yield* Effect.tryPromise(() => callRpc(serializedPayload)).pipe(Effect.orDie) // Convert errors to defects to match never error type

          // Handle ReadableStream for streaming responses
          if (serializedResponse instanceof ReadableStream) {
            const fiber = yield* processReadableStream(
              serializedResponse as CfTypes.ReadableStream,
              parser,
              writeResponse,
            ).pipe(
              // Effect.tapCauseLogPretty,
              Effect.fork,
            )

            // fiberMap.set(message.id, fiber)
            yield* FiberMap.set(fiberMap, message.id, fiber)

            yield* fiber

            return
          }

          // Handle regular Uint8Array responses
          const decoded = parser.decode(serializedResponse as Uint8Array)

          // Normalize nested arrays from server serialization (same as streaming path)
          let responseArray: any[]
          if (Array.isArray(decoded) === true) {
            responseArray = decoded.flat(1)
          } else {
            responseArray = [decoded]
          }

          // Process each response
          for (const response of responseArray) {
            yield* writeResponse(response)
          }
        }).pipe(Effect.withSpan('do-rpc-client:send'), Effect.orDie) // Ensure never error type
      }

      return {
        send,
        supportsAck: false, // DO RPC doesn't support ack mechanism like WebSockets
        supportsTransferables: false, // DO RPC doesn't support transferables yet
      }
    }),
  )
