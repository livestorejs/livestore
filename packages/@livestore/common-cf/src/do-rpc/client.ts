import {
  Effect,
  Fiber,
  FiberMap,
  Layer,
  Option,
  RpcClient,
  type RpcMessage,
  RpcSerialization,
  type Scope,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'

/** Decodes a streaming-RPC `ReadableStream`'s binary frames, writing each out as it arrives. */
const processReadableStream = (
  stream: CfTypes.ReadableStream,
  parser: RpcSerialization.Parser,
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

        for (const message of parser.decode(value as Uint8Array)) {
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
export const layerProtocolDurableObject = (args: MakeDoRpcProtocolArgs): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol, makeProtocolDurableObject(args)).pipe(
    Layer.provide(RpcSerialization.layerSchemaBinary()),
  )

/**
 * Implementation of the RPC Protocol interface using Cloudflare Durable Object RPC calls.
 * Provides the core protocol methods required by @effect/rpc.
 */
const makeProtocolDurableObject = ({
  callRpc,
}: MakeDoRpcProtocolArgs): Effect.Effect<
  RpcClient.Protocol['Service'],
  never,
  Scope.Scope | RpcSerialization.RpcSerialization
> =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse) {
      const serialization = yield* RpcSerialization.RpcSerialization
      // Not using an actual `FiberMap` here because it seems to shutdown to early
      // const fiberMap = new Map<string, Fiber.Fiber<void, never>>()
      const fiberMap = yield* FiberMap.make<string, void, never>()

      const send = (clientId: number, message: RpcMessage.FromClientEncoded): Effect.Effect<void> => {
        if (message._tag !== 'Request') {
          if (message._tag === 'Interrupt') {
            return Effect.gen(function* () {
              const fiber = yield* FiberMap.get(fiberMap, message.requestId)
              if (Option.isSome(fiber) === true) {
                yield* Fiber.interrupt(fiber.value)
              }
            }).pipe(Effect.orDie)
          }

          return Effect.void
        }

        // Binary parsers hold stream framing state, so scope one parser to one DO RPC call.
        const parser = serialization.makeUnsafe()

        // Wrap single Request in array to match server expected format
        const serializedPayload = parser.encode([message])
        if (serializedPayload instanceof Uint8Array === false) {
          return Effect.die('SchemaBinary RPC serialization did not produce bytes')
        }

        return Effect.gen(function* () {
          const serializedResponse = yield* Effect.tryPromise(() => callRpc(serializedPayload)).pipe(Effect.orDie) // Convert errors to defects to match never error type

          // Handle ReadableStream for streaming responses
          if (serializedResponse instanceof ReadableStream) {
            const fiber = yield* processReadableStream(
              serializedResponse as CfTypes.ReadableStream,
              parser,
              (response) => writeResponse(clientId, response),
            ).pipe(
              // Effect.tapCauseLogPretty,
              Effect.forkChild,
            )

            // fiberMap.set(message.id, fiber)
            yield* FiberMap.set(fiberMap, message.id, fiber)

            yield* Fiber.join(fiber)

            return
          }

          // Handle regular Uint8Array responses
          for (const response of parser.decode(serializedResponse as Uint8Array)) {
            // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- the parser validates Effect's encoded RPC envelope schema
            yield* writeResponse(clientId, response as RpcMessage.FromServerEncoded)
          }
        }).pipe(Effect.withSpan('do-rpc-client:send'), Effect.orDie) // Ensure never error type
      }

      return {
        send,
        supportsAck: false, // DO RPC doesn't support ack mechanism like WebSockets
        supportsTransferables: false, // DO RPC doesn't support transferables yet
        codecFor: serialization.codecFor,
      }
    }),
  )
