import type { EventId, SyncBackend, SyncBackendOptionsBase } from '@livestore/common'
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

Also see: https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/client.ts

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
  // TODO move this into "global" sync metadata as it's the same for each event
  shapeId: string
}

export const makeSyncBackend = ({
  electricHost,
  roomId,
  pushEventEndpoint,
}: SyncBackendOptions): Effect.Effect<SyncBackend<SyncMetadata>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const endpointUrl = `${electricHost}/v1/shape/events_${roomId}`

    const isConnected = yield* SubscriptionRef.make(true)

    const initRoom = HttpClientRequest.schemaBodyJson(ApiInitRoomPayload)(
      HttpClientRequest.post(pushEventEndpoint),
      ApiInitRoomPayload.make({ roomId }),
    ).pipe(Effect.andThen(HttpClient.execute))

    const pendingPushDeferredMap = new Map<string, Deferred.Deferred<SyncMetadata>>()

    const pull = (args: Option.Option<SyncMetadata>, { listenForNew }: { listenForNew: boolean }) =>
      Effect.gen(function* () {
        const liveParam = listenForNew ? '&live=true' : ''
        const url =
          args._tag === 'None'
            ? `${endpointUrl}?offset=-1`
            : `${endpointUrl}?offset=${args.value.offset}&shape_id=${args.value.shapeId}${liveParam}`

        const resp = yield* HttpClient.get(url).pipe(
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

        // Electric completes the long-poll request after ~20 seconds with a 204 status
        // In this case we just retry where we left off
        if (resp.status === 204) {
          return Option.some([Chunk.empty(), Option.some(nextCursor)] as const)
        }

        const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

        const items = body
          .filter((item) => item.value !== undefined)
          .map((item) => ({
            metadata: Option.some({ offset: item.offset!, shapeId: nextCursor.shapeId }),
            mutationEventEncoded: {
              mutation: item.value!.mutation,
              args: JSON.parse(item.value!.args),
              id: item.value!.id,
              parentId: item.value!.parentId,
            },
            persisted: true,
          }))

        if (listenForNew === false && items.length === 0) {
          return Option.none()
        }

        const [newItems, pendingPushItems] = Chunk.fromIterable(items).pipe(
          Chunk.partition((item) => pendingPushDeferredMap.has(eventIdToString(item.mutationEventEncoded.id))),
        )

        for (const item of pendingPushItems) {
          const deferred = pendingPushDeferredMap.get(eventIdToString(item.mutationEventEncoded.id))!
          yield* Deferred.succeed(deferred, Option.getOrThrow(item.metadata))
        }

        return Option.some([newItems, Option.some(nextCursor)] as const)
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) => InvalidPullError.make({ message: cause.toString() })),
      )

    return {
      pull: (args, { listenForNew }) =>
        Stream.unfoldChunkEffect(
          args.pipe(
            Option.map((_) => _.metadata),
            Option.flatten,
          ),
          (metadataOption) => pull(metadataOption, { listenForNew }),
        ),

      push: (mutationEventEncoded, persisted) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<SyncMetadata>()
          pendingPushDeferredMap.set(eventIdToString(mutationEventEncoded.id), deferred)

          const resp = yield* HttpClientRequest.schemaBodyJson(ApiPushEventPayload)(
            HttpClientRequest.post(pushEventEndpoint),
            ApiPushEventPayload.make({ roomId, mutationEventEncoded, persisted }),
          ).pipe(
            Effect.andThen(HttpClient.execute),
            Effect.andThen(HttpClientResponse.schemaBodyJson(Schema.Struct({ success: Schema.Boolean }))),
            Effect.scoped,
            Effect.mapError((cause) => InvalidPushError.make({ message: cause.toString() })),
          )

          if (!resp.success) {
            yield* InvalidPushError.make({ message: 'Push failed' })
          }

          const metadata = yield* Deferred.await(deferred)

          pendingPushDeferredMap.delete(eventIdToString(mutationEventEncoded.id))

          return { metadata: Option.some(metadata) }
        }),
      isConnected,
    } satisfies SyncBackend<SyncMetadata>
  })

const eventIdToString = (eventId: EventId) => `${eventId.global}_${eventId.local}`
