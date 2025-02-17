import type { SyncBackend } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { EventId } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
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
  value: Schema.optional(MutationEvent.AnyEncodedGlobal),
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
  storeId: Schema.String,
  batch: Schema.Array(MutationEvent.AnyEncodedGlobal),
})

export const ApiInitRoomPayload = Schema.TaggedStruct('sync-electric.InitRoom', {
  storeId: Schema.String,
})

export const ApiPayload = Schema.Union(ApiPushEventPayload, ApiInitRoomPayload)

export const syncBackendOptions = <TOptions extends SyncBackendOptions>(options: TOptions) => options

export interface SyncBackendOptions {
  /**
   * The host of the Electric server
   *
   * @example "https://localhost:3000"
   */
  electricHost: string
  storeId: string
  /**
   * The POST endpoint to push events to
   *
   * @example "/api/push-event"
   * @example "https://api.myapp.com/push-event"
   */
  pushEventEndpoint: string
}

type SyncMetadata = {
  offset: string
  // TODO move this into some kind of "global" sync metadata as it's the same for each event
  shapeId: string
}

export const makeSyncBackend = ({
  electricHost,
  storeId,
  pushEventEndpoint,
}: SyncBackendOptions): Effect.Effect<SyncBackend<SyncMetadata>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const endpointUrl = `${electricHost}/v1/shape/events_${storeId}`

    const isConnected = yield* SubscriptionRef.make(true)

    const initRoom = HttpClientRequest.schemaBodyJson(ApiInitRoomPayload)(
      HttpClientRequest.post(pushEventEndpoint),
      ApiInitRoomPayload.make({ storeId }),
    ).pipe(Effect.andThen(HttpClient.execute))

    // TODO check whether we still need this
    const pendingPushDeferredMap = new Map<EventId.GlobalEventId, Deferred.Deferred<SyncMetadata>>()

    const pull = (args: Option.Option<SyncMetadata>) =>
      Effect.gen(function* () {
        const url =
          args._tag === 'None'
            ? `${endpointUrl}?offset=-1`
            : `${endpointUrl}?offset=${args.value.offset}&shape_id=${args.value.shapeId}&live=true`

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
              clientId: item.value!.clientId,
              sessionId: undefined,
            },
          }))

        // // TODO implement proper `remaining` handling
        // remaining: 0,

        // if (listenForNew === false && items.length === 0) {
        //   return Option.none()
        // }

        const [newItems, pendingPushItems] = Chunk.fromIterable(items).pipe(
          Chunk.partition((item) => pendingPushDeferredMap.has(item.mutationEventEncoded.id)),
        )

        for (const item of pendingPushItems) {
          const deferred = pendingPushDeferredMap.get(item.mutationEventEncoded.id)!
          yield* Deferred.succeed(deferred, Option.getOrThrow(item.metadata))
        }

        return Option.some([newItems, Option.some(nextCursor)] as const)
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) => InvalidPullError.make({ message: cause.toString() })),
      )

    return {
      pull: (args) =>
        Stream.unfoldChunkEffect(
          args.pipe(
            Option.map((_) => _.metadata),
            Option.flatten,
          ),
          (metadataOption) => pull(metadataOption),
        ).pipe(
          Stream.chunks,
          Stream.map((chunk) => ({ batch: [...chunk], remaining: 0 })),
        ),

      push: (batch) =>
        Effect.gen(function* () {
          const deferreds: Deferred.Deferred<SyncMetadata>[] = []
          for (const mutationEventEncoded of batch) {
            const deferred = yield* Deferred.make<SyncMetadata>()
            pendingPushDeferredMap.set(mutationEventEncoded.id, deferred)
            deferreds.push(deferred)
          }

          const resp = yield* HttpClientRequest.schemaBodyJson(ApiPushEventPayload)(
            HttpClientRequest.post(pushEventEndpoint),
            ApiPushEventPayload.make({ storeId, batch }),
          ).pipe(
            Effect.andThen(HttpClient.execute),
            Effect.andThen(HttpClientResponse.schemaBodyJson(Schema.Struct({ success: Schema.Boolean }))),
            Effect.scoped,
            Effect.mapError((cause) =>
              InvalidPushError.make({ reason: { _tag: 'Unexpected', message: cause.toString() } }),
            ),
          )

          if (!resp.success) {
            yield* InvalidPushError.make({ reason: { _tag: 'Unexpected', message: 'Push failed' } })
          }

          const metadata = yield* Effect.all(deferreds, { concurrency: 'unbounded' }).pipe(
            Effect.map((_) => _.map(Option.some)),
          )

          for (const mutationEventEncoded of batch) {
            pendingPushDeferredMap.delete(mutationEventEncoded.id)
          }

          return { metadata }
        }),
      isConnected,
    } satisfies SyncBackend<SyncMetadata>
  })
