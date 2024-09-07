import type { SyncImpl } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
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
  'x-electric-schema': Schema.parseJson(Schema.Any),
  /** e.g. 26799576_0 */
  'x-electric-chunk-last-offset': Schema.String,
})

export const makeSync = (
  /**
   * The host of the Electric server
   *
   * @example "https://my-electric.com"
   */
  electricHost: string,
  roomId: string,
): Effect.Effect<SyncImpl, never, Scope.Scope> => {
  return Effect.gen(function* () {
    const endpointUrl = `${electricHost}/v1/shape/${roomId}`
    // ?offset=-1

    const isConnected = yield* SubscriptionRef.make(true)

    return {
      pull: (cursor) =>
        Stream.unfoldChunkEffect(cursor, (cursor) =>
          Effect.gen(function* () {
            const resp = yield* HttpClientRequest.get(`${endpointUrl}?offset=${cursor ?? '-1'}`).pipe(
              HttpClient.fetchOk,
            )

            const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
            const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem))(resp)

            const items = body.map((item) => item.value).filter(isNotUndefined)

            // if (items.length === 0) {
            //   return Option.none()
            // }

            return Option.some([Chunk.fromIterable(items), headers['x-electric-chunk-last-offset']] as const)
          }).pipe(
            Effect.scoped,
            Effect.mapError((cause) => InvalidPullError.make({ message: cause.toString() })),
          ),
        ),

      pushes: Stream.never,
      push: (mutationEventEncoded, persisted) => Effect.void,
      isConnected,
    } satisfies SyncImpl
  })
}
