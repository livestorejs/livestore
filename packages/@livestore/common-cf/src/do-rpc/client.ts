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
  writeResponse: (response: any) => Effect.Effect<void, never, never>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const reader = stream.getReader()

    yield* Effect.gen(function* () {
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read()).pipe(Effect.orDie)

        if (done) {
          break
        }

        // Decode the chunk
        const decoded = parser.decode(value as Uint8Array)

        // Handle array of messages - we get [[message]] from server
        let messages: any[]
        if (Array.isArray(decoded) && decoded.length === 1 && Array.isArray(decoded[0])) {
          // Double-wrapped array [[message]] -> [message]
          messages = decoded[0]
        } else if (Array.isArray(decoded)) {
          // Single array [message]
          messages = decoded
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
): Layer.Layer<RpcClient.Protocol, never, never> => Layer.scoped(RpcClient.Protocol, makeProtocolDurableObject(args))

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

      const send = (message: RpcMessage.FromClientEncoded): Effect.Effect<void, never, never> => {
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

          // Handle potential nested array from server serialization
          let responseArray: any[]
          if (Array.isArray(decoded) && decoded.length === 1 && Array.isArray(decoded[0])) {
            // Double-wrapped array [[Exit]] -> [Exit]
            responseArray = decoded[0]
          } else if (Array.isArray(decoded)) {
            // Single array [Exit]
            responseArray = decoded
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
