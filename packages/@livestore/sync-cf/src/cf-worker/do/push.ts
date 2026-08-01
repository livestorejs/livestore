import { BackendIdMismatchError, ServerAheadError, SyncBackend, UnknownError } from '@livestore/common'
import { type CfTypes, emitStreamResponse } from '@livestore/common-cf'
import { splitArrayBySize } from '@livestore/common/sync'
import { TRACE_VERBOSE } from '@livestore/utils'
import { Effect, Option, ReadonlyArray as EffectArray, type RpcMessage, Schema } from '@livestore/utils/effect'

import { MAX_PUSH_EVENTS_PER_REQUEST, MAX_WS_MESSAGE_BYTES } from '../../common/constants.ts'
import { SyncMessage } from '../../common/mod.ts'
import {
  type Env,
  type ForwardedHeaders,
  type MakeDurableObjectClassOptions,
  type StoreId,
  WebSocketAttachmentSchema,
} from '../shared.ts'
import * as DoCtx from './layer.ts'

const pullResponseJsonSchema = Schema.toCodecJson(SyncMessage.PullResponse)
const encodePullResponse = Schema.encodeSync(pullResponseJsonSchema)
const jsonStringify = Schema.encodeSync(Schema.UnknownFromJsonString)
type PullBatchItem = SyncMessage.PullResponse['batch'][number]
type PushBatchItem = SyncMessage.PushRequest['batch'][number]

export const makePush =
  ({
    payload,
    headers,
    options,
    storeId,
    ctx,
    env,
  }: {
    payload: Schema.Json | undefined
    headers: ForwardedHeaders | undefined
    options: MakeDurableObjectClassOptions | undefined
    storeId: StoreId
    ctx: CfTypes.DurableObjectState
    env: Env
  }) =>
  (pushRequest: Omit<SyncMessage.PushRequest, '_tag'>) =>
    Effect.gen(function* () {
      // yield* Effect.log(`Pushing ${decodedMessage.batch.length} events`, decodedMessage.batch)
      const { backendId, storage, currentHeadRef, updateCurrentHead, pushSemaphore, rpcSubscriptions } =
        yield* DoCtx.DoCtx

      if (pushRequest.batch.length === 0) {
        return SyncMessage.PushAck.make({})
      }

      if (options?.onPush !== undefined) {
        yield* Effect.trySyncOrPromiseOrEffect(() =>
          options.onPush!(pushRequest, {
            storeId,
            ...(payload !== undefined ? { payload } : {}),
            ...(headers !== undefined ? { headers } : {}),
          }),
        ).pipe(UnknownError.mapToUnknownError)
      }

      if (pushRequest.backendId._tag === 'Some' && pushRequest.backendId.value !== backendId) {
        return yield* new BackendIdMismatchError({ expected: backendId, received: pushRequest.backendId.value })
      }

      yield* runSerializedPushAdmission(
        pushSemaphore,
        Effect.gen(function* () {
          // Persistence stays inside the Durable Object storage transaction, while the
          // surrounding admission remains uninterruptible through ordered broadcast.
          const { createdAt } = yield* Effect.gen(function* () {
            const currentHead = currentHeadRef.current
            // TODO handle clientId unique conflict
            // Validate the batch
            const firstEventParent = pushRequest.batch[0]!.parentSeqNum
            if (firstEventParent !== currentHead) {
              return yield* new ServerAheadError({ minimumExpectedNum: currentHead, providedNum: firstEventParent })
            }

            const createdAt = new Date().toISOString()

            // TODO possibly model this as a queue in order to speed up subsequent pushes
            yield* storage.appendEvents(pushRequest.batch, createdAt)

            updateCurrentHead(pushRequest.batch.at(-1)!.seqNum)

            yield* syncDiagnostic('sync-cf.push.accepted', pushRequest.batch)

            return { createdAt }
          }).pipe(blockConcurrencyWhile(ctx))

          const connectedClients = ctx.getWebSockets()

          // Preparing chunks of responses to make sure we don't exceed the WS message size limit.
          if (EffectArray.isReadonlyArrayNonEmpty(pushRequest.batch) === false) {
            return
          }

          const responses = yield* splitArrayBySize({
            maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
            maxBytes: MAX_WS_MESSAGE_BYTES,
            encode: (items: ReadonlyArray<PushBatchItem>) =>
              encodePullResponse(
                SyncMessage.PullResponse.make({
                  batch: items.map(
                    (eventEncoded): PullBatchItem => ({
                      eventEncoded,
                      metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt })),
                    }),
                  ),
                  pageInfo: SyncBackend.pageInfoNoMore,
                  backendId,
                }),
              ),
          })(pushRequest.batch).pipe(
            Effect.map((eventBatch) =>
              eventBatch.map((events) => {
                const batchWithMetadata = events.map((eventEncoded) => ({
                  eventEncoded,
                  metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt })),
                }))

                const response = SyncMessage.PullResponse.make({
                  batch: batchWithMetadata,
                  pageInfo: SyncBackend.pageInfoNoMore,
                  backendId,
                })

                return {
                  response,
                  encoded: encodePullResponse(response),
                }
              }),
            ),
          )

          // Dual broadcasting: WebSocket + RPC clients

          // Broadcast to WebSocket clients
          if (connectedClients.length > 0) {
            for (const { response, encoded } of responses) {
              // Only calling once for now.
              if (options?.onPullRes !== undefined) {
                yield* Effect.trySyncOrPromiseOrEffect(() => options.onPullRes!(response)).pipe(
                  UnknownError.mapToUnknownError,
                )
              }

              // NOTE we're also sending the pullRes chunk to the pushing ws client as confirmation
              for (const conn of connectedClients) {
                const attachment = yield* Schema.decodeEffect(WebSocketAttachmentSchema)(conn.deserializeAttachment())

                // We're doing something a bit "advanced" here as we're directly emitting Effect RPC-compatible
                // response messsages on the Effect RPC-managed websocket connection to the WS client.
                // For this we need to get the RPC `requestId` from the WebSocket attachment.
                for (const requestId of attachment.pullRequestIds) {
                  const res: RpcMessage.ResponseChunkEncoded = {
                    _tag: 'Chunk',
                    requestId,
                    values: [encoded],
                  }
                  conn.send(jsonStringify(res))
                }
              }

              yield* syncDiagnostic(
                'sync-cf.push.broadcast',
                response.batch.map((item) => item.eventEncoded),
              )
            }

            yield* Effect.logDebug(`Broadcasted to ${connectedClients.length} WebSocket clients`)
          }

          // RPC broadcasting would require reconstructing client stubs from clientIds
          if (rpcSubscriptions.size > 0) {
            for (const subscription of rpcSubscriptions.values()) {
              for (const { encoded } of responses) {
                yield* emitStreamResponse({
                  callerContext: subscription.callerContext,
                  env,
                  requestId: subscription.requestId,
                  values: [encoded],
                }).pipe(Effect.tapCauseLogPretty, Effect.exit)
              }
            }

            yield* Effect.logDebug(`Broadcasted to ${rpcSubscriptions.size} RPC clients`)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.withSpan('push-rpc-broadcast')),
      )

      return SyncMessage.PushAck.make({})
    }).pipe(
      Effect.tap(
        Effect.fn(function* (message) {
          if (options?.onPushRes !== undefined) {
            yield* Effect.trySyncOrPromiseOrEffect(() => options.onPushRes!(message)).pipe(
              UnknownError.mapToUnknownError,
            )
          }
        }),
      ),
      Effect.mapError((cause) =>
        cause._tag === 'BackendIdMismatchError' || cause._tag === 'ServerAheadError' || cause._tag === 'UnknownError'
          ? cause
          : new UnknownError({ cause }),
      ),
      Effect.withSpan('sync-cf:do:push', { attributes: { storeId, batchSize: pushRequest.batch.length } }),
    )

/**
 * Serializes admission and defers interruption until persistence has been published to pull subscribers.
 * A committed head without its matching pull response leaves every `ServerAhead` pusher waiting forever.
 */
export const runSerializedPushAdmission = <A, E, R>(
  semaphore: DoCtx.Service['pushSemaphore'],
  admission: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => semaphore.withPermits(1)(admission.pipe(Effect.uninterruptible))

/**
 * @see https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile
 */
const blockConcurrencyWhile =
  (ctx: CfTypes.DurableObjectState) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const services = yield* Effect.context<R>()
      const exit = yield* Effect.promise(() =>
        ctx.blockConcurrencyWhile(() => eff.pipe(Effect.runPromiseExitWith(services))),
      )

      return yield* exit
    })

const syncDiagnostic = (transition: string, batch: ReadonlyArray<PushBatchItem>): Effect.Effect<void> =>
  TRACE_VERBOSE === true
    ? Effect.logDebug(
        `[livestore-sync] ${transition} ${JSON.stringify({
          count: batch.length,
          first: batch[0],
          last: batch.at(-1),
        })}`,
      )
    : Effect.void
