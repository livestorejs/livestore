import type { SyncBackend, SyncBackendOptionsBase } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { isNotUndefined } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import type { Scope } from '@livestore/utils/effect'
import {
  Chunk,
  Deferred,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Option,
  Queue,
  ReadonlyArray,
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
  // pushEvent: (
  //   mutationEventEncoded: MutationEvent.AnyEncoded,
  //   persisted: boolean,
  // ) => Effect.Effect<void, InvalidPushError>
}

interface LiveStoreGlobalElectric {
  syncBackend: SyncBackendOptions
}

declare global {
  interface LiveStoreGlobal extends LiveStoreGlobalElectric {}
}

export const makeSyncBackend = ({
  electricHost,
  roomId,
  // pushEvent,
  pushEventEndpoint,
}: SyncBackendOptions): Effect.Effect<SyncBackend, never, Scope.Scope> => {
  return Effect.gen(function* () {
    const endpointUrl = `${electricHost}/v1/shape/events_${roomId}`
    // ?offset=-1

    const isConnected = yield* SubscriptionRef.make(true)

    const initialCursorDeferred = yield* Deferred.make<{ offset: string; shapeId: string }>()

    const initRoom = HttpClientRequest.schemaBody(ApiInitRoomPayload)(
      HttpClientRequest.post(pushEventEndpoint),
      ApiInitRoomPayload.make({ roomId }),
    ).pipe(Effect.andThen(HttpClient.fetchOk))

    return {
      pull: (cursor) =>
        Stream.unfoldChunkEffect({ offset: cursor, shapeId: undefined as undefined | string }, ({ offset, shapeId }) =>
          Effect.gen(function* () {
            const url =
              offset === undefined ? `${endpointUrl}?offset=-1` : `${endpointUrl}?offset=${offset}&shape_id=${shapeId}`

            const resp = yield* HttpClientRequest.get(url).pipe(
              HttpClient.fetchOk,
              Effect.tapErrorTag('ResponseError', (error) =>
                error.response.status === 400 ? initRoom : Effect.fail(error),
              ),
              Effect.retry({ times: 1 }),
            )

            const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
            const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

            const items = body
              .map((item) => item.value)
              .filter(isNotUndefined)
              .map((item) => ({
                mutation: item.mutation,
                args: JSON.parse(item.args),
                id: item.id,
              }))

            const nextCursor = {
              offset: headers['x-electric-chunk-last-offset'],
              shapeId: headers['x-electric-shape-id'],
            }

            if (items.length === 0) {
              yield* Deferred.succeed(initialCursorDeferred, nextCursor)
              return Option.none()
            }

            return Option.some([Chunk.fromIterable(items), nextCursor] as const)
          }).pipe(
            Effect.scoped,
            Effect.mapError((cause) => InvalidPullError.make({ message: cause.toString() })),
          ),
        ),

      pushes: Effect.gen(function* () {
        const initialCursor = yield* Deferred.await(initialCursorDeferred)

        return Stream.unfoldChunkEffect(initialCursor, ({ offset, shapeId }) =>
          Effect.gen(function* () {
            const url = `${endpointUrl}?offset=${offset}&shape_id=${shapeId}&live=true`

            const resp = yield* HttpClientRequest.get(url).pipe(HttpClient.fetchOk)

            const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
            const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

            const items = body
              .map((item) => item.value)
              .filter(isNotUndefined)
              .map((item) => ({
                mutation: item.mutation,
                args: JSON.parse(item.args),
                id: item.id,
              }))

            if (items.length === 0) {
              return Option.none()
            }

            const nextCursor = {
              offset: headers['x-electric-chunk-last-offset'],
              shapeId: headers['x-electric-shape-id'],
            }

            return Option.some([Chunk.fromIterable(items), nextCursor] as const)
          }).pipe(Effect.scoped, Effect.orDie),
        )
      }).pipe(
        Stream.unwrap,
        Stream.map((mutationEventEncoded) => ({ mutationEventEncoded, persisted: true })),
      ),

      // push: (mutationEventEncoded, persisted) => pushEvent(mutationEventEncoded, persisted),
      push: (mutationEventEncoded, persisted) =>
        Effect.gen(function* () {
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
        }),
      isConnected,
    } satisfies SyncBackend
  })
}
