import {
  type Cause,
  Chunk,
  Effect,
  Exit,
  Headers,
  type Layer,
  type NonEmptyArray,
  Option,
  Rpc,
  type RpcGroup,
  type RpcMessage,
  RpcSchema,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { makeMsgPackParser, type MsgPackParser } from './msgpack.ts'

export interface ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND: never
  syncUpdateRpc: (payload: RpcMessage.ResponseChunkEncoded) => Promise<void>
}

/**
 * Construct a Durable Object RPC handler from an `RpcGroup`.
 * This is the DO equivalent of `RpcServer.toWebHandler`.
 */
export const toDurableObjectHandler =
  <Rpcs extends Rpc.Any, LE>(
    group: RpcGroup.RpcGroup<Rpcs>,
    options: {
      readonly layer: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, LE>
      readonly disableTracing?: boolean | undefined
      readonly spanPrefix?: string | undefined
      readonly spanAttributes?: Record<string, unknown> | undefined
    },
  ): ((
    serializedPayload: Uint8Array<ArrayBuffer>,
  ) => Effect.Effect<Uint8Array<ArrayBuffer> | CfTypes.ReadableStream>) =>
  (serializedPayload) =>
    Effect.gen(function* () {
      const parser = makeMsgPackParser()

      // Decode incoming requests - client sends array of requests
      const decoded = parser.decode(serializedPayload)

      // Handle potential nested array from client serialization
      let requests: RpcMessage.FromClient<Rpcs>[]
      if (Array.isArray(decoded) === true && decoded.length === 1 && Array.isArray(decoded[0]) === true) {
        // Double-wrapped array [[{...}]] -> [{...}]
        requests = decoded[0]
      } else if (Array.isArray(decoded) === true) {
        // Single array [{...}]
        requests = decoded
      } else {
        requests = []
      }

      // Get the context with handlers
      const context = yield* Effect.context<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>>()

      // Process each request
      const responses: any[] = []

      for (const request of requests) {
        if (request._tag !== 'Request') {
          continue
        }

        // Find the RPC handler
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- RpcGroup.requests map returns Rpc.Any; narrowing to AnyWithProps for property access
        const rpc = group.requests.get(request.tag)! as unknown as Rpc.AnyWithProps
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- context.unsafeMap dynamic lookup; type safety ensured by RpcGroup registration
        const entry = context.unsafeMap.get(rpc.key) as Rpc.Handler<Rpcs['_tag']>

        if (rpc == null || entry == null) {
          responses.push({
            _tag: 'Exit',
            requestId: request.id,
            exit: Exit.die(`Unknown request tag: ${request.tag}`),
          })
          continue
        }

        // Check if this is a streaming RPC
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.Handler doesn't expose successSchema publicly; see https://github.com/Effect-TS/effect/issues/6064
        const isStream = RpcSchema.isStreamSchema((rpc as any).successSchema)

        // For streaming RPCs with only one request, return ReadableStream directly
        if (isStream === true && requests.length === 1) {
          return yield* createStreamingResponse(rpc, entry, request, parser, options.layer)
        }

        // Execute the handler
        const result = yield* Effect.gen(function* () {
          const handlerResult = entry.handler(request.payload, {
            clientId: 0, // TODO: add proper clientId if needed
            headers: Headers.fromInput({
              'x-rpc-request-id': request.id.toString(),
            }),
          })

          let value: any
          if (Effect.isEffect(handlerResult) === true) {
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `Rpc.Handler.handler` returns `Effect<any, any>` due to dynamic dispatch
            value = yield* handlerResult
          } else {
            value = handlerResult
          }

          // Get the exit schema for this RPC
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>

          let encodedExit: any
          if (exitSchema !== undefined) {
            // Use schema encoding for proper serialization
            const rawExit = Exit.succeed(value)
            encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)
          } else {
            // Fallback to direct exit
            encodedExit = Exit.succeed(value)
          }

          return {
            _tag: 'Exit' as const,
            requestId: request.id,
            exit: encodedExit,
          }
        }).pipe(
          Effect.catchAllCause((cause: Cause.Cause<unknown>) => {
            // Get the exit schema for this RPC
            // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
            const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>

            return Effect.gen(function* () {
              let encodedExit: any
              if (exitSchema !== undefined) {
                // Use schema encoding for proper serialization
                const rawExit = Exit.failCause(cause)
                encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)
              } else {
                // Fallback to direct exit
                encodedExit = Exit.failCause(cause)
              }

              return {
                _tag: 'Exit' as const,
                requestId: request.id,
                exit: encodedExit,
              }
            })
          }),
        )

        responses.push(result)
      }

      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; cast to expected wire format
      const encoded = parser.encode(responses) as Uint8Array<ArrayBuffer>
      return encoded
    }).pipe(Effect.provide(options.layer), Effect.scoped, Effect.orDie)

/** Out-of-band RPC stream response emission back to the caller DO */
export const emitStreamResponse = Effect.fn('do-rpc/emitStreamResponse')(function* ({
  callerContext,
  env,
  requestId,
  values,
}: {
  env: Record<string, any>
  callerContext: { bindingName: string; durableObjectId: string }
  requestId: string
  values: NonEmptyArray<any>
}) {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- CF worker env bindings are typed as Record<string, any>; narrowing to known DO namespace
  const clientDoNamespace = env[callerContext.bindingName] as
    | CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
    | undefined

  if (clientDoNamespace === undefined) {
    throw new Error(`Client DO namespace not found: ${callerContext.bindingName}`)
  }

  const clientDo = clientDoNamespace.get(clientDoNamespace.idFromString(callerContext.durableObjectId))

  const res: RpcMessage.ResponseChunkEncoded = { _tag: 'Chunk', requestId, values }

  yield* Effect.tryPromise(() => clientDo.syncUpdateRpc(res))
})

/**
 * Creates a ReadableStream response for streaming RPCs.
 * This converts an Effect Stream into a ReadableStream of serialized RPC messages.
 */
const createStreamingResponse = <Rpcs extends Rpc.Any, LE>(
  rpc: Rpc.AnyWithProps,
  entry: Rpc.Handler<Rpcs['_tag']>,
  request: any,
  parser: MsgPackParser,
  layer: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, LE>,
): Effect.Effect<CfTypes.ReadableStream, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Execute the handler to get the stream
    const handlerResult = entry.handler(request.payload, {
      clientId: 0, // TODO: add proper clientId if needed
      headers: Headers.fromInput({
        'x-rpc-request-id': request.id.toString(),
      }),
    })

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `Rpc.Handler.handler` returns `Effect<any, any>` due to dynamic dispatch; orDie converts the error to a defect handled by the downstream catchAllCause
    const stream: Stream.Stream<any, any> =
      Effect.isEffect(handlerResult) === true ? yield* Effect.orDie(handlerResult) : handlerResult

    // Get the stream schemas for proper chunk-level encoding
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.Handler doesn't expose successSchema publicly; see https://github.com/Effect-TS/effect/issues/6064
    const streamSchemas = RpcSchema.getStreamSchemas((rpc as any).successSchema.ast)
    const chunkEncoder =
      Option.isSome(streamSchemas) === true
        ? // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- stream schema success type is inferred as unknown; cast needed for encodeUnknown
          Schema.encodeUnknown(Schema.Array(streamSchemas.value.success as Schema.Schema<any>))
        : // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Schema.Any needs explicit cast for Schema.Array compatibility
          Schema.encodeUnknown(Schema.Array(Schema.Any as Schema.Schema<any>))

    // Convert stream to ReadableStream
    const readableStream = new ReadableStream({
      start(controller) {
        // Run the stream and send chunks + final exit
        const runStream = Effect.gen(function* () {
          // Process stream chunks - let chunk encoder handle Effect objects properly
          yield* Stream.runForEachChunk(stream, (chunk: Chunk.Chunk<any>) =>
            Effect.gen(function* () {
              const chunkArray = Chunk.toReadonlyArray(chunk)
              if (chunkArray.length === 0) return

              // Encode the chunk using the proper chunk encoder (like official RPC)
              const encodedValues = yield* chunkEncoder(chunkArray)

              const chunkMessage = {
                _tag: 'Chunk' as const,
                requestId: request.id,
                values: encodedValues,
              }

              // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; cast to expected wire format
              const serialized = parser.encode([chunkMessage]) as Uint8Array<ArrayBuffer>
              controller.enqueue(serialized)
            }),
          )

          // Send final exit message with proper schema encoding
          const rawExit = Exit.void
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>
          const encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)

          const exitMessage = {
            _tag: 'Exit' as const,
            requestId: request.id,
            exit: encodedExit,
          }

          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; cast to expected wire format
          const exitSerialized = parser.encode([exitMessage]) as Uint8Array<ArrayBuffer>
          controller.enqueue(exitSerialized)
          controller.close()
        }).pipe(
          Effect.catchAllCause((cause: Cause.Cause<unknown>) =>
            Effect.gen(function* () {
              // Send error exit with proper schema encoding
              const rawExit = Exit.failCause(cause)
              // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
              const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>
              const encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)

              const exitMessage = {
                _tag: 'Exit' as const,
                requestId: request.id,
                exit: encodedExit,
              }

              // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; cast to expected wire format
              const exitSerialized = parser.encode([exitMessage]) as Uint8Array<ArrayBuffer>
              controller.enqueue(exitSerialized)
              controller.close()
            }),
          ),
        )

        // Run the stream processing
        runStream.pipe(Effect.provide(layer), Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)
      },
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API ReadableStream to Cloudflare Worker ReadableStream type
    }) as any as CfTypes.ReadableStream

    // yield* Effect.addFinalizer(() => Effect.promise(() => readableStream.cancel()))

    return readableStream
  })
