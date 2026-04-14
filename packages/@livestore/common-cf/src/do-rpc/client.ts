import { Effect, Fiber, FiberMap, Layer, RpcClient, type RpcMessage, type Scope } from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { decodeStreamChunk, makeMsgPackParser, type MsgPackParser, normalizeDecodedMessages } from './msgpack.ts'

/**
 * Processes a ReadableStream response from streaming RPCs.
 * Reads chunks from the stream and writes them as RPC responses.
 */
const processReadableStream = (
  stream: CfTypes.ReadableStream,
  parser: MsgPackParser,
  writeResponse: (response: RpcMessage.FromServerEncoded) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reader = stream.getReader()
    let pending: Uint8Array<ArrayBufferLike> = new Uint8Array()

    yield* Effect.gen(function* () {
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read()).pipe(Effect.orDie)

        if (done === true) {
          break
        }

        const { messages, pending: nextPending } = decodeStreamChunk(parser, value as Uint8Array, pending)
        pending = nextPending

        for (const decoded of messages) {
          const responses = normalizeDecodedMessages(decoded) as RpcMessage.FromServerEncoded[]

          for (const response of responses) {
            yield* writeResponse(response)
          }
        }
      }

      if (pending.length > 0) {
        const { messages, pending: finalPending } = decodeStreamChunk(parser, new Uint8Array(), pending)

        for (const decoded of messages) {
          const responses = normalizeDecodedMessages(decoded) as RpcMessage.FromServerEncoded[]

          for (const response of responses) {
            yield* writeResponse(response)
          }
        }

        if (finalPending.length > 0) {
          throw new Error(`Incomplete MessagePack data at stream end (${finalPending.length} bytes pending)`)
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
export const layerProtocolDurableObject = (args: MakeDoRpcProtocolArgs): Layer.Layer<RpcClient.Protocol> =>
  Layer.scoped(RpcClient.Protocol, makeProtocolDurableObject(args))

/**
 * Implementation of the RPC Protocol interface using Cloudflare Durable Object RPC calls.
 * Provides the core protocol methods required by @effect/rpc.
 */
const makeProtocolDurableObject = ({
  callRpc,
}: MakeDoRpcProtocolArgs): Effect.Effect<RpcClient.Protocol['Type'], never, Scope.Scope> =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse: (response: RpcMessage.FromServerEncoded) => Effect.Effect<void>) {
      const parser = makeMsgPackParser()
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
        const serializedPayload = parser.encode([message])

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

          const responseArray = normalizeDecodedMessages(decoded) as RpcMessage.FromServerEncoded[]

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
