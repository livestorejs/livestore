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
  SchemaIssue,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'

const erasedCodec = (codecFor: RpcSerialization.CodecFor, schema: Schema.Top) =>
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- erased RPC data schemas require no codec services
  codecFor(schema as Schema.Codec<unknown, unknown, never, never>)

const schemaBinarySerialization = RpcSerialization.RpcSerialization.pipe(
  Effect.provide(RpcSerialization.layerSchemaBinary()),
)

const encodeBytes = (parser: RpcSerialization.Parser, value: unknown): Uint8Array<ArrayBuffer> => {
  const encoded = parser.encode(value)
  if (encoded instanceof Uint8Array === false) {
    throw new TypeError('SchemaBinary RPC serialization did not produce bytes')
  }
  return encoded as Uint8Array<ArrayBuffer>
}

export interface ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND: never
  /**
   * The sync backend calls this to deliver a live update; `storeId` lets a rebuilt DO reload its
   * store before delivering. See the Cloudflare Durable Object adapter docs for the recovery options.
   */
  syncUpdateRpc: (payload: Uint8Array<ArrayBuffer>, storeId: string) => Promise<void>
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
      const serialization = yield* schemaBinarySerialization
      const parser = serialization.makeUnsafe()

      // Decode incoming requests - client sends array of requests
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- the parser validates Effect's encoded RPC envelope schema
      const requests = parser.decode(serializedPayload) as RpcMessage.FromClientEncoded[]

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

        const payloadResult = yield* Schema.decodeUnknownEffect(erasedCodec(serialization.codecFor, rpc.payloadSchema))(
          request.payload,
        ).pipe(Effect.provideContext(entry.context), Effect.result)

        if (Result.isFailure(payloadResult) === true) {
          // Request payloads are encoded with the JSON codec by Effect's RPC client. Decode them
          // before dispatch so JSON-only representations such as `null` become their schema values.
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
          const rawExit = Exit.die(SchemaIssue.makeFormatterDefault()(payloadResult.failure.issue))
          const encodedExit = yield* Schema.encodeUnknownEffect(erasedCodec(serialization.codecFor, exitSchema))(
            rawExit,
          ).pipe(Effect.provideContext(entry.context))
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
          return yield* createStreamingResponse(
            rpc,
            entry,
            requestId,
            payload,
            parser,
            serialization.codecFor,
            options.layer,
          )
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
            encodedExit = yield* Schema.encodeUnknownEffect(erasedCodec(serialization.codecFor, exitSchema))(rawExit)
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
                encodedExit = yield* Schema.encodeUnknownEffect(erasedCodec(serialization.codecFor, exitSchema))(
                  rawExit,
                )
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

      return encodeBytes(parser, responses)
    }).pipe(Effect.provide(options.layer), Effect.scoped, Effect.orDie) as Effect.Effect<
      Uint8Array<ArrayBuffer> | CfTypes.ReadableStream
    >

/** Out-of-band RPC stream response emission back to the caller DO */
export const emitStreamResponse = Effect.fn('do-rpc/emitStreamResponse')(function* ({
  callerContext,
  env,
  requestId,
  schema,
  storeId,
  values,
}: {
  env: Record<string, any>
  callerContext: { bindingName: string; durableObjectId: string }
  requestId: string
  storeId: string
  schema: Schema.Top
  values: ReadonlyArray.NonEmptyReadonlyArray<unknown>
}) {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- CF worker env bindings are typed as Record<string, any>; narrowing to known DO namespace
  const clientDoNamespace = env[callerContext.bindingName] as
    | CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
    | undefined

  if (clientDoNamespace === undefined) {
    throw new Error(`Client DO namespace not found: ${callerContext.bindingName}`)
  }

  const clientDo = clientDoNamespace.get(clientDoNamespace.idFromString(callerContext.durableObjectId))

  const serialization = yield* schemaBinarySerialization
  const parser = serialization.makeUnsafe()
  const encodedValues = yield* Schema.encodeUnknownEffect(
    erasedCodec(serialization.codecFor, Schema.NonEmptyArray(schema)),
  )(values)
  const res = { _tag: 'Chunk', requestId, values: encodedValues }
  // Native Cloudflare RPC rejects schema values with custom prototypes. Keep the callback
  // boundary clone-safe by sending the already-encoded Effect RPC message as bytes.
  const serializedRes = encodeBytes(parser, res)

  yield* Effect.tryPromise(() => clientDo.syncUpdateRpc(serializedRes, storeId))
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
  parser: RpcSerialization.Parser,
  codecFor: RpcSerialization.CodecFor,
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

    const stream: Stream.Stream<any, any> =
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `Rpc.Handler.handler` returns `Effect<any, any>` due to dynamic dispatch; orDie converts the error to a defect handled by the downstream catchCause
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
        ? Schema.encodeUnknownEffect(erasedCodec(codecFor, Schema.NonEmptyArray(streamSchemas.value.success)))
        : Schema.encodeUnknownEffect(erasedCodec(codecFor, Schema.NonEmptyArray(Schema.Any)))

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

              controller.enqueue(encodeBytes(parser, [chunkMessage]))
            }),
          )

          // Send final exit message with proper schema encoding
          const rawExit = Exit.void
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
          const encodedExit = yield* Schema.encodeUnknownEffect(erasedCodec(codecFor, exitSchema))(rawExit)

          const exitMessage = {
            _tag: 'Exit' as const,
            requestId,
            exit: encodedExit,
          }

          controller.enqueue(encodeBytes(parser, [exitMessage]))
          controller.close()
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              // Send error exit with proper schema encoding
              const rawExit = Exit.failCause(cause)
              // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Rpc.exitSchema requires AnyWithProps; type narrowing already done above
              const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Top
              const encodedExit = yield* Schema.encodeUnknownEffect(erasedCodec(codecFor, exitSchema))(rawExit)

              const exitMessage = {
                _tag: 'Exit' as const,
                requestId,
                exit: encodedExit,
              }

              controller.enqueue(encodeBytes(parser, [exitMessage]))
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
