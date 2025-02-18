import type { IsOfflineError, SyncBackend } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { EventId } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
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

import * as ApiSchema from './api-schema.js'

export * as ApiSchema from './api-schema.js'

/*
Example data:

[
    {
        "value": {
            "args": "{\"id\": \"127c3df4-0855-4587-ae75-14463f4a3aa0\", \"text\": \"1\"}",
            "clientId": "S_YOa",
            "id": "0",
            "mutation": "addTodo",
            "parentId": "-1"
        },
        "key": "\"public\".\"events_9069baf0_b3e6_42f7_980f_188416eab3fx3\"/\"0\"",
        "headers": {
            "last": true,
            "relation": [
                "public",
                "events_9069baf0_b3e6_42f7_980f_188416eab3fx3"
            ],
            "operation": "insert",
            "lsn": 27294160,
            "op_position": 0,
            "txids": [
                753
            ]
        }
    },
    {
        "headers": {
            "control": "up-to-date",
            "global_last_seen_lsn": 27294160
        }
    }
]


Also see: https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/client.ts

*/

const MutationEventGlobalFromStringRecord = Schema.Struct({
  id: Schema.NumberFromString,
  parentId: Schema.NumberFromString,
  mutation: Schema.String,
  args: Schema.parseJson(Schema.Any),
  clientId: Schema.String,
  sessionId: Schema.optional(Schema.String),
}).pipe(
  Schema.transform(MutationEvent.AnyEncodedGlobal, {
    decode: (_) => _,
    encode: (_) => _,
  }),
)

const ResponseItem = Schema.Struct({
  /** Postgres path (e.g. `"public"."events_9069baf0_b3e6_42f7_980f_188416eab3fx3"/"0"`) */
  key: Schema.optional(Schema.String),
  value: Schema.optional(MutationEventGlobalFromStringRecord),
  headers: Schema.Union(
    Schema.Struct({
      operation: Schema.Union(Schema.Literal('insert'), Schema.Literal('update'), Schema.Literal('delete')),
      relation: Schema.Array(Schema.String),
    }),
    Schema.Struct({
      control: Schema.String,
    }),
  ),
})

const ResponseHeaders = Schema.Struct({
  'electric-handle': Schema.String,
  // 'electric-schema': Schema.parseJson(Schema.Any),
  /** e.g. 26799576_0 */
  'electric-offset': Schema.String,
})

export const syncBackend = {} as any

export const syncBackendOptions = <TOptions extends SyncBackendOptions>(options: TOptions) => options

export const makeElectricUrl = (electricHost: string, searchParams: URLSearchParams) => {
  const endpointUrl = `${electricHost}/v1/shape`
  const argsResult = Schema.decodeUnknownEither(Schema.Struct({ args: Schema.parseJson(ApiSchema.PullPayload) }))(
    Object.fromEntries(searchParams.entries()),
  )

  if (argsResult._tag === 'Left') {
    return shouldNeverHappen('Invalid search params', searchParams)
  }

  const args = argsResult.right.args
  const tableName = toTableName(args.storeId)
  const url =
    args.handle._tag === 'None'
      ? `${endpointUrl}?table=${tableName}&offset=-1`
      : `${endpointUrl}?table=${tableName}&offset=${args.handle.value.offset}&handle=${args.handle.value.handle}&live=true`

  return { url, storeId: args.storeId, needsInit: args.handle._tag === 'None' }
}

export interface SyncBackendOptions {
  storeId: string
  /**
   * The endpoint to pull/push events. Pull is a `GET` request, push is a `POST` request.
   * Usually this endpoint is part of your API layer to proxy requests to the Electric server
   * e.g. to implement auth, rate limiting, etc.
   *
   * @example "/api/electric"
   * @example { push: "/api/push-event", pull: "/api/pull-event" }
   */
  endpoint:
    | string
    | {
        push: string
        pull: string
      }
}

export const SyncMetadata = Schema.Struct({
  offset: Schema.String,
  // TODO move this into some kind of "global" sync metadata as it's the same for each event
  handle: Schema.String,
})

type SyncMetadata = {
  offset: string
  // TODO move this into some kind of "global" sync metadata as it's the same for each event
  handle: string
}

export const makeSyncBackend = ({
  storeId,
  endpoint,
}: SyncBackendOptions): Effect.Effect<SyncBackend<SyncMetadata>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const isConnected = yield* SubscriptionRef.make(true)
    const pullEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.pull
    const pushEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.push

    // TODO check whether we still need this
    const pendingPushDeferredMap = new Map<EventId.GlobalEventId, Deferred.Deferred<SyncMetadata>>()

    const pull = (
      handle: Option.Option<SyncMetadata>,
    ): Effect.Effect<
      Option.Option<
        readonly [
          Chunk.Chunk<{ metadata: Option.Option<SyncMetadata>; mutationEventEncoded: MutationEvent.AnyEncodedGlobal }>,
          Option.Option<SyncMetadata>,
        ]
      >,
      InvalidPullError | IsOfflineError,
      HttpClient.HttpClient
    > =>
      Effect.gen(function* () {
        const argsJson = yield* Schema.encode(Schema.parseJson(ApiSchema.PullPayload))(
          ApiSchema.PullPayload.make({ storeId, handle }),
        )
        const url = `${pullEndpoint}?args=${argsJson}`

        const resp = yield* HttpClient.get(url)

        const headers = yield* HttpClientResponse.schemaHeaders(ResponseHeaders)(resp)
        const nextHandle = {
          offset: headers['electric-offset'],
          handle: headers['electric-handle'],
        }

        // Electric completes the long-poll request after ~20 seconds with a 204 status
        // In this case we just retry where we left off
        if (resp.status === 204) {
          return Option.some([Chunk.empty(), Option.some(nextHandle)] as const)
        }

        const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem), {
          onExcessProperty: 'preserve',
        })(resp)

        const items = body
          .filter((item) => item.value !== undefined && (item.headers as any).operation === 'insert')
          .map((item) => ({
            metadata: Option.some({ offset: nextHandle.offset!, handle: nextHandle.handle }),
            mutationEventEncoded: item.value! as MutationEvent.AnyEncodedGlobal,
          }))

        // // TODO implement proper `remaining` handling
        // remaining: 0,

        // if (listenForNew === false && items.length === 0) {
        //   return Option.none()
        // }

        for (const item of items) {
          const deferred = pendingPushDeferredMap.get(item.mutationEventEncoded.id)
          if (deferred !== undefined) {
            yield* Deferred.succeed(deferred, Option.getOrThrow(item.metadata))
          }
        }

        return Option.some([Chunk.fromIterable(items), Option.some(nextHandle)] as const)
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

          const resp = yield* HttpClientRequest.schemaBodyJson(ApiSchema.PushPayload)(
            HttpClientRequest.post(pushEndpoint),
            ApiSchema.PushPayload.make({ storeId, batch }),
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

/**
 * Needs to be bumped when the storage format changes (e.g. mutationLogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 3

export const toTableName = (storeId: string) => {
  const escapedStoreId = storeId.replaceAll(/[^a-zA-Z0-9_]/g, '_')
  return `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${escapedStoreId}`
}
