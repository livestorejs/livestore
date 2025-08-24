import {
  InvalidPullError,
  InvalidPushError,
  type IsOfflineError,
  SyncBackend,
  UnexpectedError,
} from '@livestore/common'
import { LiveStoreEvent } from '@livestore/common/schema'
import { notYetImplemented } from '@livestore/utils'
import {
  type Duration,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Option,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import * as ApiSchema from './api-schema.ts'

export * as ApiSchema from './api-schema.ts'
export * from './make-electric-url.ts'

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
        ping: string
      }

  ping?: {
    /**
     * @default true
     */
    enabled?: boolean
    /**
     * How long to wait for a ping response before timing out
     * @default 10 seconds
     */
    requestTimeout?: Duration.DurationInput
    /**
     * How often to send ping requests
     * @default 10 seconds
     */
    requestInterval?: Duration.DurationInput
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
  ({ endpoint, ...options }: SyncBackendOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(false)
      const pullEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.pull
      const pushEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.push
      const pingEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.ping

      const httpClient = yield* HttpClient.HttpClient

      const runPull = (
        handle: Option.Option<SyncMetadata>,
        { live }: { live: boolean },
      ): Effect.Effect<
        Option.Option<
          readonly [
            /** The batch of events */
            ReadonlyArray<{
              metadata: Option.Option<SyncMetadata>
              eventEncoded: LiveStoreEvent.AnyEncodedGlobal
            }>,
            /** The next handle to use for the next pull */
            Option.Option<SyncMetadata>,
          ]
        >,
        InvalidPullError | IsOfflineError
      > =>
        Effect.gen(function* () {
          const argsJson = yield* Schema.encode(ApiSchema.ArgsSchema)(
            ApiSchema.PullPayload.make({ storeId, handle, payload, live }),
          )
          const url = `${pullEndpoint}?args=${argsJson}`

          const resp = yield* httpClient.get(url)

          if (resp.status === 401) {
            const body = yield* resp.text.pipe(Effect.catchAll(() => Effect.succeed('-')))
            return yield* InvalidPullError.make({
              cause: new Error(`Unauthorized (401): Couldn't connect to ElectricSQL: ${body}`),
            })
          } else if (resp.status === 400) {
            // Electric returns 400 when table doesn't exist
            // Return empty result for non-existent tables
            return Option.some([[], Option.none()] as const)
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
            const body = yield* resp.text
            return yield* InvalidPullError.make({
              cause: new Error(`Unexpected status code: ${resp.status}: ${body}`),
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
            return Option.some([[], Option.some(nextHandle)] as const)
          }

          const body = yield* HttpClientResponse.schemaBodyJson(Schema.Array(ResponseItem), {
            onExcessProperty: 'preserve',
          })(resp)

          const items = body
            .filter((item) => item.value !== undefined && (item.headers as any).operation === 'insert')
            .map((item) => ({
              metadata: Option.some({ offset: nextHandle.offset, handle: nextHandle.handle }),
              eventEncoded: item.value! as LiveStoreEvent.AnyEncodedGlobal,
            }))

          yield* Effect.annotateCurrentSpan({ itemsCount: items.length, nextHandle })

          return Option.some([items, Option.some(nextHandle)] as const)
        }).pipe(
          Effect.scoped,
          Effect.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause }))),
          Effect.withSpan('electric-provider:runPull', { attributes: { handle, live } }),
        )

      const pullEndpointHasSameOrigin =
        pullEndpoint.startsWith('/') ||
        (globalThis.location !== undefined && globalThis.location.origin === new URL(pullEndpoint).origin)

      const pingTimeout = options.ping?.requestTimeout ?? 10_000

      const ping: SyncBackend.SyncBackend<SyncMetadata>['ping'] = Effect.gen(function* () {
        yield* httpClient.pipe(HttpClient.filterStatusOk).head(pingEndpoint)

        yield* SubscriptionRef.set(isConnected, true)
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.timeout(pingTimeout),
        Effect.catchTag('TimeoutException', () => SubscriptionRef.set(isConnected, false)),
        Effect.withSpan('electric-provider:ping'),
      )

      const pingInterval = options.ping?.requestInterval ?? 10_000

      if (options.ping?.enabled !== false) {
        // Automatically ping the server to keep the connection alive
        yield* ping.pipe(Effect.repeat(Schedule.spaced(pingInterval)), Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      // If the pull endpoint has the same origin as the current page, we can assume that we already have a connection
      // otherwise we send a HEAD request to speed up the connection process
      const connect: SyncBackend.SyncBackend<SyncMetadata>['connect'] = pullEndpointHasSameOrigin
        ? Effect.void
        : ping.pipe(UnexpectedError.mapToUnexpectedError)

      return SyncBackend.of({
        connect,
        pull: (args, options) => {
          let hasEmittedAtLeastOnce = false

          return Stream.unfoldEffect(
            args.pipe(
              Option.map((_) => _.metadata),
              Option.flatten,
            ),
            (metadataOption) =>
              Effect.gen(function* () {
                const result = yield* runPull(metadataOption, { live: options?.live ?? false })
                if (Option.isNone(result)) return Option.none()

                const [batch, nextMetadataOption] = result.value

                // Continue pagination if we have data
                if (batch.length > 0) {
                  hasEmittedAtLeastOnce = true
                  return Option.some([{ batch, hasMore: true }, nextMetadataOption])
                }

                // Make sure we emit at least once even if there's no data or we're live-pulling
                if (hasEmittedAtLeastOnce === false || options?.live) {
                  hasEmittedAtLeastOnce = true
                  return Option.some([{ batch, hasMore: false }, nextMetadataOption])
                }

                // Stop on empty batch (when not live)
                return Option.none()
              }),
          ).pipe(
            Stream.map(({ batch, hasMore }) => ({
              batch,
              pageInfo: hasMore ? SyncBackend.pageInfoMoreUnknown : SyncBackend.pageInfoNoMore,
            })),
            Stream.withSpan('electric-provider:pull'),
          )
        },

        push: (batch) =>
          Effect.gen(function* () {
            const resp = yield* HttpClientRequest.schemaBodyJson(ApiSchema.PushPayload)(
              HttpClientRequest.post(pushEndpoint),
              ApiSchema.PushPayload.make({ storeId, batch }),
            ).pipe(
              Effect.andThen(httpClient.pipe(HttpClient.filterStatusOk).execute),
              Effect.andThen(HttpClientResponse.schemaBodyJson(Schema.Struct({ success: Schema.Boolean }))),
              Effect.scoped,
              Effect.mapError((cause) => InvalidPushError.make({ reason: { _tag: 'Unexpected', cause } })),
            )

            if (!resp.success) {
              return yield* InvalidPushError.make({ reason: { _tag: 'Unexpected', cause: new Error('Push failed') } })
            }
          }).pipe(Effect.withSpan('electric-provider:push')),
        ping,
        isConnected,
        metadata: {
          name: '@livestore/sync-electric',
          description: 'LiveStore sync backend implementation using ElectricSQL',
          protocol: 'http',
          endpoint,
        },
        supports: {
          // Given Electric is heavily optimized for immutable caching, we can't know the remaining count
          // until we've reached the end of the stream
          pullPageInfoKnown: false,
          pullLive: true,
        },
      })
    })
