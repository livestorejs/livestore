import {
  Chunk,
  Effect,
  Exit,
  Headers,
  type Layer,
  Option,
  Rpc,
  type RpcGroup,
  RpcSchema,
  RpcSerialization,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'
import type * as CfTypes from '../cf-types.ts'

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
      const parser = RpcSerialization.msgPack.unsafeMake()

      // Decode incoming requests - client sends array of requests
      const decoded = parser.decode(serializedPayload)

      // Handle potential nested array from client serialization
      let requests: any[]
      if (Array.isArray(decoded) && decoded.length === 1 && Array.isArray(decoded[0])) {
        // Double-wrapped array [[{...}]] -> [{...}]
        requests = decoded[0]
      } else if (Array.isArray(decoded)) {
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
        const rpc = group.requests.get(request.tag)! as unknown as Rpc.AnyWithProps
        const entry = context.unsafeMap.get(rpc.key) as Rpc.Handler<Rpcs['_tag']>

        if (!rpc || !entry) {
          responses.push({
            _tag: 'Exit',
            requestId: request.id,
            exit: Exit.die(`Unknown request tag: ${request.tag}`),
          })
          continue
        }

        // Check if this is a streaming RPC
        const isStream = RpcSchema.isStreamSchema((rpc as any).successSchema)

        // For streaming RPCs with only one request, return ReadableStream directly
        if (isStream && requests.length === 1) {
          return yield* createStreamingResponse(rpc, entry, request, parser, options.layer)
        }

        // Execute the handler
        const result = yield* Effect.gen(function* () {
          const handlerResult = entry.handler(request.payload, Headers.empty)

          let value: any
          if (Effect.isEffect(handlerResult)) {
            value = yield* handlerResult
          } else {
            value = handlerResult
          }

          // Get the exit schema for this RPC
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>

          let encodedExit: any
          if (exitSchema) {
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
          Effect.catchAllCause((cause) => {
            // Get the exit schema for this RPC
            const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>

            return Effect.gen(function* () {
              let encodedExit: any
              if (exitSchema) {
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

      const encoded = parser.encode(responses) as Uint8Array<ArrayBuffer>
      return encoded
    }).pipe(Effect.provide(options.layer), Effect.scoped, Effect.orDie)

/**
 * Creates a ReadableStream response for streaming RPCs.
 * This converts an Effect Stream into a ReadableStream of serialized RPC messages.
 */
const createStreamingResponse = <Rpcs extends Rpc.Any, LE>(
  rpc: Rpc.AnyWithProps,
  entry: Rpc.Handler<Rpcs['_tag']>,
  request: any,
  parser: ReturnType<typeof RpcSerialization.msgPack.unsafeMake>,
  layer: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, LE>,
): Effect.Effect<CfTypes.ReadableStream, any, Scope.Scope> =>
  Effect.gen(function* () {
    // Execute the handler to get the stream
    const handlerResult = entry.handler(request.payload, Headers.empty)

    let stream: Stream.Stream<any, any, never>
    if (Effect.isEffect(handlerResult)) {
      // If handler returns Effect<Stream>, we need to run it to get the stream
      stream = yield* handlerResult
    } else {
      // Direct stream
      stream = handlerResult
    }

    // Get the stream schemas for proper chunk-level encoding
    const streamSchemas = RpcSchema.getStreamSchemas((rpc as any).successSchema.ast)
    const chunkEncoder = Option.isSome(streamSchemas)
      ? Schema.encodeUnknown(Schema.Array(streamSchemas.value.success))
      : Schema.encodeUnknown(Schema.Array(Schema.Any))

    // Convert stream to ReadableStream
    const readableStream = new ReadableStream({
      start(controller) {
        // Run the stream and send chunks + final exit
        const runStream = Effect.gen(function* () {
          // Process stream chunks - let chunk encoder handle Effect objects properly
          yield* Stream.runForEachChunk(stream, (chunk) =>
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

              const serialized = parser.encode([chunkMessage]) as Uint8Array<ArrayBuffer>
              controller.enqueue(serialized)
            }),
          )

          // Send final exit message with proper schema encoding
          const rawExit = Exit.void
          const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>
          const encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)

          const exitMessage = {
            _tag: 'Exit' as const,
            requestId: request.id,
            exit: encodedExit,
          }

          const exitSerialized = parser.encode([exitMessage]) as Uint8Array<ArrayBuffer>
          controller.enqueue(exitSerialized)
          controller.close()
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.gen(function* () {
              // Send error exit with proper schema encoding
              const rawExit = Exit.failCause(cause)
              const exitSchema = Rpc.exitSchema(rpc as any) as Schema.Schema<any>
              const encodedExit = yield* Schema.encodeUnknown(exitSchema)(rawExit)

              const exitMessage = {
                _tag: 'Exit' as const,
                requestId: request.id,
                exit: encodedExit,
              }

              const exitSerialized = parser.encode([exitMessage]) as Uint8Array<ArrayBuffer>
              controller.enqueue(exitSerialized)
              controller.close()
            }),
          ),
        )

        // Run the stream processing
        // @ts-expect-error - Complex context requirements but functionality works correctly
        runStream.pipe(Effect.provide(layer), Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)
      },
    }) as any as CfTypes.ReadableStream

    // yield* Effect.addFinalizer(() => Effect.promise(() => readableStream.cancel()))

    return readableStream
  })
