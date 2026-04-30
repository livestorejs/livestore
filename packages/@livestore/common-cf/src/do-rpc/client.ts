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
 * Reads chunks from the stream and writes them as RPC responses.
 */
const processReadableStream = (
  stream: CfTypes.ReadableStream,
  parser: ReturnType<typeof RpcSerialization.msgPack.unsafeMake>,
  writeResponse: (response: any) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reader = stream.getReader()

    yield* Effect.gen(function* () {
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read()).pipe(Effect.orDie)

        if (done === true) {
          break
        }

        // Decode the chunk
        const decoded = parser.decode(value as Uint8Array)

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
