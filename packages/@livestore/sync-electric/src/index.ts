import type { SyncBackend, SyncBackendOptionsBase } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import type { Scope } from '@livestore/utils/effect'
import {
  Chunk,
  Deferred,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

/*
Example data:

[{"key":"\"public\".\"events\"/\"1\"","value":{"id":"1","mutation":"test","args_json":"{\"test\":\"test\"}","schema_hash":"1","created_at":"2024-09-07T10:05:31.445Z"},"headers":{"operation":"insert","relation":["public","events"]},"offset":"0_0"}
,{"key":"\"public\".\"events\"/\"1725703554783\"","value":{"id":"1725703554783","mutation":"test","args_json":"{\"test\":\"test\"}","schema_hash":"1","created_at":"2024-09-07T10:05:54.783Z"},"headers":{"operation":"insert","relation":["public","events"]},"offset":"0_0"}
,{"headers":{"control":"up-to-date"}}]

*/

const ResponseItem = Schema.Struct({
  /** Postgres path (e.g. "public.events/1") */
  key: Schema.optional(Schema.String),
  value: Schema.optional(mutationEventSchemaEncodedAny),
  headers: Schema.Record({ key: Schema.String, value: Schema.Any }),
  offset: Schema.optional(Schema.String),
})

const ResponseHeaders = Schema.Struct({
  'x-electric-shape-id': Schema.String,
  // 'x-electric-schema': Schema.parseJson(Schema.Any),
  /** e.g. 26799576_0 */
  'x-electric-chunk-last-offset': Schema.String,
})

export const syncBackend = {} as any

export const ApiPushEventPayload = Schema.TaggedStruct('sync-electric.PushEvent', {
  roomId: Schema.String,
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export const ApiInitRoomPayload = Schema.TaggedStruct('sync-electric.InitRoom', {
  roomId: Schema.String,
})

export const ApiPayload = Schema.Union(ApiPushEventPayload, ApiInitRoomPayload)

export const syncBackendOptions = <TOptions extends SyncBackendOptions>(options: TOptions) => options

export interface SyncBackendOptions extends SyncBackendOptionsBase {
  type: 'electric'
  /**
   * The host of the Electric server
   *
   * @example "https://localhost:3000"
   */
  electricHost: string
  roomId: string
  /**
   * The POST endpoint to push events to
   *
   * @example "/api/push-event"
   * @example "https://api.myapp.com/push-event"
   */
  pushEventEndpoint: string
}

interface LiveStoreGlobalElectric {
  syncBackend: SyncBackendOptions
}

declare global {
  interface LiveStoreGlobal extends LiveStoreGlobalElectric {}
}

type SyncMetadata = {
  offset: string
  shapeId: string
}

export const makeSyncBackend = ({
  electricHost,
  roomId,
  pushEventEndpoint,
}: SyncBackendOptions): Effect.Effect<SyncBackend<SyncMetadata | null>, never, Scope.Scope> => {
  return Effect.gen(function* () {
    const endpointUrl = `${electricHost}/v1/shape/events_${roomId}`

    const isConnected = yield* SubscriptionRef.make(true)

    const initialCursorDeferred = yield* Deferred.make<SyncMetadata>()

    const initRoom = HttpClientRequest.schemaBody(ApiInitRoomPayload)(
      HttpClientRequest.post(pushEventEndpoint),
      ApiInitRoomPayload.make({ roomId }),
    ).pipe(Effect.andThen(HttpClient.fetchOk))

    const pendingPushDeferredMap = new Map<string, Deferred.Deferred<SyncMetadata>>()

    const pull = ({ offset, shapeId }: { offset: string | undefined; shapeId: string | undefined }) =>
      Effect.gen(function* () {
        const url =
          offset === undefined ? `${endpointUrl}?offset=-1` : `${endpointUrl}?offset=${offset}&shape_id=${shapeId}`

        const resp = yield* HttpClientRequest.get(url).pipe(
          HttpClient.fetchOk,
          Effect.tapErrorTag('ResponseError', (error) =>
            // TODO handle 409 error when the shapeId you request no longer exists for whatever reason.
            // The correct behavior here is to refetch the shape from scratch and to reset the local state.
            error.response.status === 400 ? initRoom : Effect.fail(error),
          ),
          Effect.retry({ times: 1 }),
        )

        const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
        const nextCursor = {
          offset: headers['x-electric-chunk-last-offset'],
          shapeId: headers['x-electric-shape-id'],
        }

        const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

        const items = body
          .filter((item) => item.value !== undefined)
          .map((item) => ({
            metadata: { offset: item.offset!, shapeId: nextCursor.shapeId },
            mutationEventEncoded: {
              mutation: item.value!.mutation,
              args: JSON.parse(item.value!.args),
              id: item.value!.id,
            },
          }))

        if (items.length === 0) {
          yield* Deferred.succeed(initialCursorDeferred, nextCursor)
          return Option.none()
        }

        return Option.some([Chunk.fromIterable(items), nextCursor] as const)
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) => InvalidPullError.make({ message: cause.toString() })),
      )

    return {
      pull: (_cursor, metadata) =>
        Stream.unfoldChunkEffect({ offset: metadata?.offset, shapeId: metadata?.shapeId }, ({ offset, shapeId }) =>
          pull({ offset, shapeId }),
        ),

      pushes: Effect.gen(function* () {
        const initialCursor = yield* Deferred.await(initialCursorDeferred)

        return Stream.unfoldChunkEffect(initialCursor, ({ offset, shapeId }) =>
          Effect.gen(function* () {
            const url = `${endpointUrl}?offset=${offset}&shape_id=${shapeId}&live=true`

            const resp = yield* HttpClientRequest.get(url).pipe(HttpClient.fetchOk)

            const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
            const nextCursor = {
              offset: headers['x-electric-chunk-last-offset'],
              shapeId,
            }

            if (resp.status === 204) {
              return Option.some([Chunk.empty(), nextCursor] as const)
            }

            const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

            const items = body
              .filter((item) => item.value !== undefined)
              .map((item) => ({
                metadata: { offset: item.offset!, shapeId },
                mutationEventEncoded: {
                  mutation: item.value!.mutation,
                  args: JSON.parse(item.value!.args),
                  id: item.value!.id,
                },
                persisted: true,
              }))

            const [newItems, pendingPushItems] = Chunk.fromIterable(items).pipe(
              Chunk.partition((item) => pendingPushDeferredMap.has(item.mutationEventEncoded.id)),
            )

            for (const item of pendingPushItems) {
              const deferred = pendingPushDeferredMap.get(item.mutationEventEncoded.id)!
              yield* Deferred.succeed(deferred, item.metadata)
            }

            return Option.some([newItems, nextCursor] as const)
          }).pipe(Effect.scoped, Effect.orDie),
        )
      }).pipe(Stream.unwrap),

      push: (mutationEventEncoded, persisted) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<SyncMetadata>()
          pendingPushDeferredMap.set(mutationEventEncoded.id, deferred)

          const resp = yield* HttpClientRequest.schemaBody(ApiPushEventPayload)(
            HttpClientRequest.post(pushEventEndpoint),
            ApiPushEventPayload.make({ roomId, mutationEventEncoded, persisted }),
          ).pipe(
            Effect.andThen(HttpClient.fetchOk),
            Effect.andThen(HttpClientResponse.schemaBodyJson(Schema.Struct({ success: Schema.Boolean }))),
            Effect.scoped,
            Effect.mapError((cause) => InvalidPushError.make({ message: cause.toString() })),
          )

          if (!resp.success) {
            yield* InvalidPushError.make({ message: 'Push failed' })
          }

          const metadata = yield* Deferred.await(deferred)

          return { metadata }
        }),
      isConnected,
    } satisfies SyncBackend<SyncMetadata | null>
  })
}
