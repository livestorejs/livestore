/**
 * S2 Sync Provider — Client Overview
 *
 * Architecture
 * - This package implements LiveStore's SyncBackend over a simple HTTP API that we call the "API proxy".
 *   The proxy exposes three verbs compatible with LiveStore's sync contract:
 *     - GET `/?args=...`   → pull pages of events
 *     - POST `/`           → push a batch of events
 *     - HEAD `/`           → ping (reachability)
 * - In tests, the API proxy bridges to the hosted S2 service. The proxy remains focused on app logic; all
 *   reusable logic (schemas, helpers, client behavior) is factored into this package.
 *
 * LiveStore → S2 mapping
 * - storeId → S2 stream name (sanitized). Each store maps to one S2 stream.
 * - LiveStore event (AnyEncodedGlobal) → S2 record body (string). We JSON-encode the event and set it as the
 *   S2 record body. We currently do not rely on S2 record headers.
 * - Sequence numbers → INDEPENDENT systems. LiveStore's seqNum (in event payload) tracks logical event ordering;
 *   S2's seq_num tracks physical stream position. Both start at 0 but are decoupled by design to support future
 *   optimizations like compaction. SyncMetadata tracks S2's position separately for cursor management.
 * - Pull (cursor) → S2 `seq_num`. The cursor uses SyncMetadata.s2SeqNum for stream positioning, not LiveStore's seqNum.
 * - Live pulling → S2 SSE tail. SSE streaming provides real-time event delivery without polling.
 *
 * S2 constraints & considerations
 * - Append limits: respect S2 batch count/byte limits; add retries/backoff for 4xx/5xx.
 * - Provisioning: basin / stream lifecycle is kept outside of the client (API proxy / service concern).
 * - Formatting: when speaking to S2 directly, prefer `s2-format: raw` for JSON record bodies and ensure UTF‑8.
 * - Sequence numbers: S2 assigns `seq_num`; LiveStore's event sequence is preserved inside the event payload.
 *   DO NOT couple these systems together or assume 1:1 correspondence.
 *
 * Errors
 * - push → InvalidPushError on non‑2xx; pull → InvalidPullError on non‑2xx; ping/connect map timeouts to offline.
 * - The proxy should surface helpful status codes and error bodies.
 */
import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import {
  type Duration,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Option,
  Schedule,
  Schema,
  Sse,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import * as ApiSchema from './api-schema.ts'
import { decodeReadBatch } from './decode.ts'
import * as HttpClientGenerated from './http-client-generated.ts'
import type { SyncMetadata } from './types.ts'

export interface SyncS2Options {
  endpoint:
    | string
    | {
        push: string
        pull: string
        ping: string
      }
  ping?: {
    /** Enable periodic ping; default true */
    enabled?: boolean
    /** Timeout for individual ping request; default 10s */
    requestTimeout?: Duration.DurationInput
    /** Interval between ping requests; default 10s */
    requestInterval?: Duration.DurationInput
  }
  retry?: {
    /** Custom retry schedule for non-live pulls (default: 2 recurs, 100ms spaced) */
    pull?: Schedule.Schedule<number, InvalidPullError>
    /** Custom retry schedule for pushes (default: 2 recurs, 100ms spaced) */
    push?: Schedule.Schedule<number, InvalidPushError>
  }
}

export const defaultRetry = Schedule.compose(Schedule.recurs(2), Schedule.spaced(100))

export const makeSyncBackend =
  ({ endpoint, ping: pingOptions, retry }: SyncS2Options): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(false)
      const pullEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.pull
      const pushEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.push
      const pingEndpoint = typeof endpoint === 'string' ? endpoint : endpoint.ping

      const httpClient = yield* HttpClient.HttpClient

      const pullEndpointHasSameOrigin =
        pullEndpoint.startsWith('/') ||
        (globalThis.location !== undefined && globalThis.location.origin === new URL(pullEndpoint).origin)

      const pingTimeout = pingOptions?.requestTimeout ?? 10_000

      const ping: SyncBackend.SyncBackend<SyncMetadata>['ping'] = Effect.gen(function* () {
        yield* httpClient.pipe(HttpClient.filterStatusOk).head(pingEndpoint)
        yield* SubscriptionRef.set(isConnected, true)
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.timeout(pingTimeout),
        Effect.catchTag('TimeoutException', () => SubscriptionRef.set(isConnected, false)),
      )

      const pingInterval = pingOptions?.requestInterval ?? 10_000
      if (pingOptions?.enabled !== false) {
        yield* ping.pipe(Effect.repeat(Schedule.spaced(pingInterval)), Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      // No need to connect if the pull endpoint has the same origin as the current page
      const connect: SyncBackend.SyncBackend<SyncMetadata>['connect'] = pullEndpointHasSameOrigin
        ? Effect.void
        : ping.pipe(UnexpectedError.mapToUnexpectedError)

      const runPullSse = (
        cursor: Option.Option<{
          eventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber
          metadata: Option.Option<SyncMetadata>
        }>,
        live: boolean,
      ): Stream.Stream<SyncBackend.PullResItem<SyncMetadata>, InvalidPullError> => {
        // Extract S2 seqNum from metadata for SSE cursor
        const s2SeqNum = cursor.pipe(
          Option.flatMap((_) => _.metadata),
          Option.map((_) => _.s2SeqNum),
          Option.getOrElse(() => 'from-start' as const),
        )

        const argsJson = Schema.encodeSync(ApiSchema.ArgsSchema)({ storeId, payload, s2SeqNum, live })
        const url = `${pullEndpoint}?args=${argsJson}`

        return httpClient
          .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders({ accept: 'text/event-stream' })))
          .pipe(
            HttpClientResponse.stream,
            // decode text and split into lines
            Stream.decodeText('utf8'),
            Stream.pipeThroughChannel(Sse.makeChannel()),
            // Filter out pings, map errors to stream failures
            Stream.mapEffect(
              Effect.fnUntraced(function* (msg) {
                const evt = msg.event.toLowerCase()
                if (evt === 'ping') return Option.none()
                if (evt === 'error') {
                  return yield* new InvalidPullError({ cause: new Error(`SSE error: ${msg.data}`) })
                }
                if (evt === 'batch') {
                  const readBatch = yield* Schema.decode(Schema.parseJson(HttpClientGenerated.ReadBatch))(msg.data)
                  const batch = decodeReadBatch(readBatch)

                  const lastS2SeqNum = batch.at(-1)?.metadata.pipe(
                    Option.map((_) => _.s2SeqNum),
                    Option.getOrUndefined,
                  )
                  const tailSeqNum = readBatch.tail?.seq_num
                  const remaining =
                    lastS2SeqNum !== undefined && tailSeqNum !== undefined
                      ? Math.max(0, tailSeqNum - (lastS2SeqNum + 1))
                      : undefined

                  return Option.some({
                    batch,
                    pageInfo:
                      remaining !== undefined && remaining > 0
                        ? SyncBackend.pageInfoMoreKnown(remaining)
                        : SyncBackend.pageInfoNoMore,
                  })
                }
                // emitted when reached the end of the stream
                if (evt === 'message' && msg.data === '[DONE]') {
                  return Option.none()
                }
                return shouldNeverHappen(`Unexpected SSE event: ${evt}`, msg)
              }),
            ),
            Stream.filterMap((_) => _), // filter out Option.none()
            Stream.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : new InvalidPullError({ cause }))),
            Stream.retry(retry?.pull ?? defaultRetry),
          )
      }

      const ssePull = (
        startCursor: Option.Option<{
          eventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber
          metadata: Option.Option<SyncMetadata>
        }>,
      ): Stream.Stream<SyncBackend.PullResItem<SyncMetadata>, InvalidPullError> => {
        const computeNextCursor = (
          lastItem: Option.Option<SyncBackend.PullResItem<SyncMetadata>>,
          current: Option.Option<{
            eventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber
            metadata: Option.Option<SyncMetadata>
          }>,
        ) =>
          lastItem.pipe(
            Option.flatMap((item) => {
              const lastBatchItem = item.batch.at(-1)
              if (!lastBatchItem) return Option.none()
              return Option.some({
                eventSequenceNumber: lastBatchItem.eventEncoded.seqNum,
                metadata: lastBatchItem.metadata,
              })
            }),
            Option.orElse(() => current),
          )

        const loop = (
          cursor: Option.Option<{
            eventSequenceNumber: EventSequenceNumber.GlobalEventSequenceNumber
            metadata: Option.Option<SyncMetadata>
          }>,
          isFirst: boolean,
        ): Stream.Stream<SyncBackend.PullResItem<SyncMetadata>, InvalidPullError> => {
          const sseStream = (live: boolean) =>
            runPullSse(cursor, live).pipe(
              Stream.emitIfEmpty({
                batch: [],
                pageInfo: SyncBackend.pageInfoNoMore,
              } as SyncBackend.PullResItem<SyncMetadata>),
            )

          const stream = isFirst ? sseStream(false) : sseStream(true)

          return stream.pipe(
            // Reconnect from last item if stream
            Stream.concatWithLastElement((lastItem) => loop(computeNextCursor(lastItem, cursor), false)),
          )
        }

        return loop(startCursor, true)
      }

      return SyncBackend.of({
        connect,
        pull: (cursor, options) => {
          if (options?.live) {
            return ssePull(cursor)
          } else {
            return runPullSse(cursor, false).pipe(
              Stream.emitIfEmpty({
                batch: [],
                pageInfo: SyncBackend.pageInfoNoMore,
              } as SyncBackend.PullResItem<SyncMetadata>),
            )
          }
        },
        push: (batch) =>
          HttpClientRequest.schemaBodyJson(ApiSchema.PushPayload)(HttpClientRequest.post(pushEndpoint), {
            storeId,
            batch,
          }).pipe(
            Effect.andThen(httpClient.pipe(HttpClient.filterStatusOk).execute),
            Effect.andThen(HttpClientResponse.schemaBodyJson(ApiSchema.PushResponse)),
            Effect.mapError((cause) => InvalidPushError.make({ cause: UnexpectedError.make({ cause }) })),
            Effect.retry(retry?.push ?? defaultRetry),
          ),
        ping,
        isConnected,
        metadata: {
          name: '@livestore/sync-s2',
          description: 'LiveStore sync backend implementation for S2',
          protocol: 'http',
          endpoint,
        },
        supports: {
          pullPageInfoKnown: false,
          pullLive: true,
        },
      })
    })
