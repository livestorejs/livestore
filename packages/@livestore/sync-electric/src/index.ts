import {
  InvalidPullError,
  InvalidPushError,
  type IsOfflineError,
  SyncBackend,
  UnexpectedError,
} from '@livestore/common'
import { LiveStoreEvent } from '@livestore/common/schema'
import { notYetImplemented, shouldNeverHappen } from '@livestore/utils'
import {
  Chunk,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import * as ApiSchema from './api-schema.ts'

export * as ApiSchema from './api-schema.ts'

/*
Example data:

[
    {
        "value": {
            "args": "{\"id\": \"127c3df4-0855-4587-ae75-14463f4a3aa0\", \"text\": \"1\"}",
            "clientId": "S_YOa",
            "id": "0",
            "name": "todoCreated",
            "parentSeqNum": "-1"
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

const LiveStoreEventGlobalFromStringRecord = Schema.Struct({
  seqNum: Schema.NumberFromString,
  parentSeqNum: Schema.NumberFromString,
  name: Schema.String,
  args: Schema.parseJson(Schema.Any),
  clientId: Schema.String,
  sessionId: Schema.String,
}).pipe(
  Schema.transform(LiveStoreEvent.AnyEncodedGlobal, {
    decode: (_) => _,
    encode: (_) => _,
  }),
)

const ResponseItem = Schema.Struct({
  /** Postgres path (e.g. `"public"."events_9069baf0_b3e6_42f7_980f_188416eab3fx3"/"0"`) */
  key: Schema.optional(Schema.String),
  value: Schema.optional(LiveStoreEventGlobalFromStringRecord),
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

/**
 * This function should be called in a trusted environment (e.g. a proxy server) as it
 * requires access to senstive information (e.g. `apiSecret` / `sourceSecret`).
 */
export const makeElectricUrl = ({
  electricHost,
  searchParams: providedSearchParams,
  sourceId,
  sourceSecret,
  apiSecret,
}: {
  electricHost: string
  /**
   * Needed to extract information from the search params which the `@livestore/sync-electric`
   * client implementation automatically adds:
   * - `handle`: the ElectricSQL handle
   * - `storeId`: the Livestore storeId
   */
  searchParams: URLSearchParams
  /** Needed for Electric Cloud */
  sourceId?: string
  /** Needed for Electric Cloud */
  sourceSecret?: string
  /** For self-hosted ElectricSQL */
  apiSecret?: string
}) => {
  const endpointUrl = `${electricHost}/v1/shape`
  const argsResult = Schema.decodeUnknownEither(Schema.Struct({ args: Schema.parseJson(ApiSchema.PullPayload) }))(
    Object.fromEntries(providedSearchParams.entries()),
  )

  if (argsResult._tag === 'Left') {
    return shouldNeverHappen(
      'Invalid search params provided to makeElectricUrl',
      providedSearchParams,
      Object.fromEntries(providedSearchParams.entries()),
    )
  }

  const args = argsResult.right.args
  const tableName = toTableName(args.storeId)
  const searchParams = new URLSearchParams()
  searchParams.set('table', tableName)
  if (sourceId !== undefined) {
    searchParams.set('source_id', sourceId)
  }
  if (sourceSecret !== undefined) {
    searchParams.set('source_secret', sourceSecret)
  }
  if (apiSecret !== undefined) {
    searchParams.set('api_secret', apiSecret)
  }
  if (args.handle._tag === 'None') {
    searchParams.set('offset', '-1')
  } else {
    searchParams.set('offset', args.handle.value.offset)
    searchParams.set('handle', args.handle.value.handle)
    searchParams.set('live', 'true')
  }

  const payload = args.payload

  const url = `${endpointUrl}?${searchParams.toString()}`

  return { url, storeId: args.storeId, needsInit: args.handle._tag === 'None', payload }
}

export interface SyncBackendOptions {
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

export const makeSyncBackend =
  ({ endpoint }: SyncBackendOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(true)
      const pullEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.pull
      const pushEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.push

      const pull = (
        handle: Option.Option<SyncMetadata>,
      ): Effect.Effect<
        Option.Option<
          readonly [
            Chunk.Chunk<{
              metadata: Option.Option<SyncMetadata>
              eventEncoded: LiveStoreEvent.AnyEncodedGlobal
            }>,
            Option.Option<SyncMetadata>,
          ]
        >,
        InvalidPullError | IsOfflineError,
        HttpClient.HttpClient
      > =>
        Effect.gen(function* () {
          const argsJson = yield* Schema.encode(Schema.parseJson(ApiSchema.PullPayload))(
            ApiSchema.PullPayload.make({ storeId, handle, payload }),
          )
          const url = `${pullEndpoint}?args=${argsJson}`

          const resp = yield* HttpClient.get(url)

          if (resp.status === 401) {
            const body = yield* resp.text.pipe(Effect.catchAll(() => Effect.succeed('-')))
            return yield* InvalidPullError.make({
              message: `Unauthorized (401): Couldn't connect to ElectricSQL: ${body}`,
            })
          } else if (resp.status === 409) {
            // https://electric-sql.com/openapi.html#/paths/~1v1~1shape/get
            // {
            // "message": "The shape associated with this shape_handle and offset was not found. Resync to fetch the latest shape",
            // "shape_handle": "2494_84241",
            // "offset": "-1"
            // }

            // TODO: implementation plan:
            // start pulling events from scratch with the new handle and ignore the "old events"
            // until we found a new event, then, continue with the new handle
            return notYetImplemented(`Electric shape not found`)
          } else if (resp.status < 200 || resp.status >= 300) {
            return yield* InvalidPullError.make({
              message: `Unexpected status code: ${resp.status}`,
            })
          }

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
              eventEncoded: item.value! as LiveStoreEvent.AnyEncodedGlobal,
            }))

          // // TODO implement proper `remaining` handling
          // remaining: 0,

          // if (listenForNew === false && items.length === 0) {
          //   return Option.none()
          // }

          return Option.some([Chunk.fromIterable(items), Option.some(nextHandle)] as const)
        }).pipe(
          Effect.scoped,
          Effect.mapError((cause) =>
            cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ message: cause.toString() }),
          ),
        )

      const pullEndpointHasSameOrigin =
        pullEndpoint.startsWith('/') ||
        (globalThis.location !== undefined && globalThis.location.origin === new URL(pullEndpoint).origin)

      return SyncBackend.of({
        // If the pull endpoint has the same origin as the current page, we can assume that we already have a connection
        // otherwise we send a HEAD request to speed up the connection process
        connect: pullEndpointHasSameOrigin
          ? Effect.void
          : HttpClient.head(pullEndpoint).pipe(UnexpectedError.mapToUnexpectedError),
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
              return yield* InvalidPushError.make({ reason: { _tag: 'Unexpected', message: 'Push failed' } })
            }
          }),
        isConnected,
        metadata: {
          name: '@livestore/sync-electric',
          description: 'LiveStore sync backend implementation using ElectricSQL',
          protocol: 'http',
          endpoint,
        },
      })
    })

/**
 * Needs to be bumped when the storage format changes (e.g. eventlogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 6

export const toTableName = (storeId: string) => {
  const escapedStoreId = storeId.replaceAll(/[^a-zA-Z0-9_]/g, '_')
  return `eventlog_${PERSISTENCE_FORMAT_VERSION}_${escapedStoreId}`
}
