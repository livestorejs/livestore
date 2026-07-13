import {
  Effect,
  Exit,
  Headers,
  type Layer,
  Option,
  type ReadonlyArray,
  Rpc,
  type RpcGroup,
  RpcMessage,
  RpcSchema,
  RpcSerialization,
  Result,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'

export interface ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND: never
  syncUpdateRpc: (payload: Uint8Array<ArrayBuffer>) => Promise<void>
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
      const parser = RpcSerialization.msgPack.makeUnsafe()

      // Decode incoming requests - client sends array of requests
      const decoded = parser.decode(serializedPayload)

      // Handle potential nested array from client serialization
      let requests: RpcMessage.FromClientEncoded[]
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
        const requestId = RpcMessage.RequestId(request.id)

        // Find the RPC handler
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- RpcGroup.requests map returns Rpc.Any; narrowing to AnyWithProps for property access
        const rpc = group.requests.get(request.tag)! as unknown as Rpc.AnyWithProps
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- context.mapUnsafe dynamic lookup; type safety ensured by RpcGroup registration
        const entry = context.mapUnsafe.get(rpc.key) as Rpc.Handler<Rpcs['_tag']>

        if (rpc == null || entry == null) {
          responses.push({
            _tag: 'Exit',
            requestId,
            exit: Exit.die(`Unknown request tag: ${request.tag}`),
          })
          continue
        }

        const payloadResult = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(rpc.payloadSchema))(
          request.payload,
        ).pipe(Effect.provideContext(entry.context), Effect.result)

        if (Result.isFailure(payloadResult) === true) {
          // Request payloads are encoded with the JSON codec by Effect's RPC client. Decode them
          // before dispatch so JSON-only representations such as `null` become their schema values.
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
          const rawExit = Exit.die(payloadResult.failure.issue.toString())
          const encodedExit = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(exitSchema))(rawExit).pipe(
            Effect.provideContext(entry.context),
          )
          responses.push({
            _tag: 'Exit',
            requestId,
            exit: encodedExit,
          })
          continue
        }

        const payload = payloadResult.success

        // Check if this is a streaming RPC
        const isStream = RpcSchema.isStreamSchema(rpc.successSchema)

        // For streaming RPCs with only one request, return ReadableStream directly
        if (isStream === true && requests.length === 1) {
          return yield* createStreamingResponse(rpc, entry, requestId, payload, parser, options.layer)
        }

        // Execute the handler
        const result = yield* Effect.gen(function* () {
          const handlerResult = entry.handler(payload, {
            client: new Rpc.ServerClient(0), // TODO: add proper clientId if needed
            requestId,
            headers: Headers.fromInput({
              'x-rpc-request-id': requestId.toString(),
            }),
            rpc,
          })
          const effectOrStream = Rpc.isWrapper(handlerResult) === true ? handlerResult.value : handlerResult

          let value: any
          if (Effect.isEffect(effectOrStream) === true) {
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `Rpc.Handler.handler` returns `Effect<any, any>` due to dynamic dispatch
            value = yield* effectOrStream
          } else {
            value = effectOrStream
          }

          // Get the exit schema for this RPC
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top

          let encodedExit: any
          if (exitSchema !== undefined) {
            // Use schema encoding for proper serialization
            const rawExit = Exit.succeed(value)
            encodedExit = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(exitSchema))(rawExit)
          } else {
            // Fallback to direct exit
            encodedExit = Exit.succeed(value)
          }

          return {
            _tag: 'Exit' as const,
            requestId,
            exit: encodedExit,
          }
        }).pipe(
          Effect.catchCause((cause) => {
            // Get the exit schema for this RPC
            // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
            const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top

            return Effect.gen(function* () {
              let encodedExit: any
              if (exitSchema !== undefined) {
                // Use schema encoding for proper serialization
                const rawExit = Exit.failCause(cause)
                encodedExit = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(exitSchema))(rawExit)
              } else {
                // Fallback to direct exit
                encodedExit = Exit.failCause(cause)
              }

              return {
                _tag: 'Exit' as const,
                requestId,
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
    }).pipe(Effect.provide(options.layer), Effect.scoped, Effect.orDie) as Effect.Effect<
      Uint8Array<ArrayBuffer> | CfTypes.ReadableStream
    >

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
  values: ReadonlyArray.NonEmptyReadonlyArray<any>
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
  const parser = RpcSerialization.msgPack.makeUnsafe()
  // Native Cloudflare RPC rejects schema values with custom prototypes. Keep the callback
  // boundary clone-safe by sending the already-encoded Effect RPC message as bytes.
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; the encoded result is a byte payload
  const serializedRes = parser.encode(res) as Uint8Array<ArrayBuffer>

  yield* Effect.tryPromise(() => clientDo.syncUpdateRpc(serializedRes))
})

/**
 * Creates a ReadableStream response for streaming RPCs.
 * This converts an Effect Stream into a ReadableStream of serialized RPC messages.
 */
const createStreamingResponse = <Rpcs extends Rpc.Any, LE>(
  rpc: Rpc.AnyWithProps,
  entry: Rpc.Handler<Rpcs['_tag']>,
  requestId: RpcMessage.RequestId,
  payload: unknown,
  parser: ReturnType<typeof RpcSerialization.msgPack.makeUnsafe>,
  layer: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, LE>,
): Effect.Effect<CfTypes.ReadableStream, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Execute the handler to get the stream
    const handlerResult = entry.handler(payload, {
      client: new Rpc.ServerClient(0), // TODO: add proper clientId if needed
      requestId,
      headers: Headers.fromInput({
        'x-rpc-request-id': requestId.toString(),
      }),
      rpc,
    })
    const effectOrStream = Rpc.isWrapper(handlerResult) === true ? handlerResult.value : handlerResult

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `Rpc.Handler.handler` returns `Effect<any, any>` due to dynamic dispatch; orDie converts the error to a defect handled by the downstream catchCause
    const stream: Stream.Stream<any, any> =
      Effect.isEffect(effectOrStream) === true ? yield* Effect.orDie(effectOrStream) : effectOrStream

    // Get the stream schemas for proper chunk-level encoding
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.Handler doesn't expose successSchema publicly; see https://github.com/Effect-TS/effect/issues/6064
    const streamSchemas =
      RpcSchema.isStreamSchema(rpc.successSchema) === true
        ? Option.some({
            success: rpc.successSchema.success,
            error: rpc.successSchema.error,
          })
        : Option.none()
    const arrayEncoder =
      Option.isSome(streamSchemas) === true
        ? Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Array(streamSchemas.value.success)))
        : Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Array(Schema.Any)))

    // Convert stream to ReadableStream
    const readableStream = new ReadableStream({
      start(controller) {
        // Run the stream and send chunks + final exit
        const runStream = Effect.gen(function* () {
          // Process stream chunks - let chunk encoder handle Effect objects properly
          yield* Stream.runForEachArray(stream, (array) =>
            Effect.gen(function* () {
              if (array.length === 0) return

              // Encode the chunk using the proper chunk encoder (like official RPC)
              const encodedValues = yield* arrayEncoder(array)

              const chunkMessage = {
                _tag: 'Chunk' as const,
                requestId,
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
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
          const encodedExit = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(exitSchema))(rawExit)

          const exitMessage = {
            _tag: 'Exit' as const,
            requestId,
            exit: encodedExit,
          }

          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- msgPack parser.encode returns unknown; cast to expected wire format
          const exitSerialized = parser.encode([exitMessage]) as Uint8Array<ArrayBuffer>
          controller.enqueue(exitSerialized)
          controller.close()
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              // Send error exit with proper schema encoding
              const rawExit = Exit.failCause(cause)
              // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
              const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
              const encodedExit = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(exitSchema))(rawExit)

              const exitMessage = {
                _tag: 'Exit' as const,
                requestId,
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
        runStream.pipe(
          Effect.provide(layer),
          Effect.scoped,
          Effect.tapCauseLogPretty,
          (_) => _ as Effect.Effect<void>,
          Effect.runPromise,
        )
      },
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridging standard Web API ReadableStream to Cloudflare Worker ReadableStream type
    }) as any as CfTypes.ReadableStream

    // yield* Effect.addFinalizer(() => Effect.promise(() => readableStream.cancel()))

    return readableStream
  })
