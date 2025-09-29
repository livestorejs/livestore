import {
  BackendIdMismatchError,
  InvalidPushError,
  ServerAheadError,
  SyncBackend,
  UnexpectedError,
} from '@livestore/common'
import { type CfTypes, emitStreamResponse } from '@livestore/common-cf'
import { Chunk, Effect, Option, type RpcMessage, Schema } from '@livestore/utils/effect'
import { MAX_PUSH_EVENTS_PER_REQUEST, MAX_WS_MESSAGE_BYTES } from '../../common/constants.ts'
import { SyncMessage } from '../../common/mod.ts'
import { splitChunkBySize } from '../../common/transport-chunking.ts'
import { type Env, type MakeDurableObjectClassOptions, type StoreId, WebSocketAttachmentSchema } from '../shared.ts'
import { DoCtx } from './layer.ts'

const encodePullResponse = Schema.encodeSync(SyncMessage.PullResponse)
type PullBatchItem = SyncMessage.PullResponse['batch'][number]

export const makePush =
  ({
    payload,
    options,
    storeId,
    ctx,
    env,
  }: {
    payload: Schema.JsonValue | undefined
    options: MakeDurableObjectClassOptions | undefined
    storeId: StoreId
    ctx: CfTypes.DurableObjectState
    env: Env
  }) =>
  (pushRequest: Omit<SyncMessage.PushRequest, '_tag'>) =>
    Effect.gen(function* () {
      // yield* Effect.log(`Pushing ${decodedMessage.batch.length} events`, decodedMessage.batch)
      const { backendId, storage, currentHeadRef, updateCurrentHead, rpcSubscriptions } = yield* DoCtx

      if (pushRequest.batch.length === 0) {
        return SyncMessage.PushAck.make({})
      }

      if (options?.onPush) {
        yield* Effect.tryAll(() => options.onPush!(pushRequest, { storeId, payload })).pipe(
          UnexpectedError.mapToUnexpectedError,
        )
      }

      if (pushRequest.backendId._tag === 'Some' && pushRequest.backendId.value !== backendId) {
        return yield* new BackendIdMismatchError({ expected: backendId, received: pushRequest.backendId.value })
      }

      // This part of the code needs to run sequentially to avoid race conditions
      const { createdAt } = yield* Effect.gen(function* () {
        const currentHead = currentHeadRef.current
        // TODO handle clientId unique conflict
        // Validate the batch
        const firstEventParent = pushRequest.batch[0]!.parentSeqNum
        if (firstEventParent !== currentHead) {
          // yield* Effect.logDebug('ServerAheadError: backend head mismatch', {
          //   expectedHead: currentHead,
          //   providedHead: firstEventParent,
          //   batchSize: pushRequest.batch.length,
          //   backendId,
          // })

          return yield* new ServerAheadError({ minimumExpectedNum: currentHead, providedNum: firstEventParent })
        }

        const createdAt = new Date().toISOString()

        // TODO possibly model this as a queue in order to speed up subsequent pushes
        yield* storage.appendEvents(pushRequest.batch, createdAt)

        updateCurrentHead(pushRequest.batch.at(-1)!.seqNum)

        return { createdAt }
      }).pipe(blockConcurrencyWhile(ctx))

      // Run in background but already return the push ack to the client
      yield* Effect.gen(function* () {
        const connectedClients = ctx.getWebSockets()

        // Preparing chunks of responses to make sure we don't exceed the WS message size limit.
        const responses = yield* Chunk.fromIterable(pushRequest.batch).pipe(
          splitChunkBySize({
            maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
            maxBytes: MAX_WS_MESSAGE_BYTES,
            encode: (items) =>
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
          }),
          Effect.map(
            Chunk.map((eventsChunk) => {
              const batchWithMetadata = Chunk.toReadonlyArray(eventsChunk).map((eventEncoded) => ({
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
                encoded: Schema.encodeSync(SyncMessage.PullResponse)(response),
              }
            }),
          ),
        )

        // Dual broadcasting: WebSocket + RPC clients

        // Broadcast to WebSocket clients
        if (connectedClients.length > 0) {
          for (const { response, encoded } of responses) {
            // Only calling once for now.
            if (options?.onPullRes) {
              yield* Effect.tryAll(() => options.onPullRes!(response)).pipe(UnexpectedError.mapToUnexpectedError)
            }

            // NOTE we're also sending the pullRes chunk to the pushing ws client as confirmation
            for (const conn of connectedClients) {
              const attachment = Schema.decodeSync(WebSocketAttachmentSchema)(conn.deserializeAttachment())

              // We're doing something a bit "advanced" here as we're directly emitting Effect RPC-compatible
              // response messsages on the Effect RPC-managed websocket connection to the WS client.
              // For this we need to get the RPC `requestId` from the WebSocket attachment.
              for (const requestId of attachment.pullRequestIds) {
                const res: RpcMessage.ResponseChunkEncoded = {
                  _tag: 'Chunk',
                  requestId,
                  values: [encoded],
                }
                conn.send(JSON.stringify(res))
              }
            }
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
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.withSpan('push-rpc-broadcast'),
        Effect.uninterruptible, // We need to make sure Effect RPC doesn't interrupt this fiber
        Effect.fork,
      )

      // We need to yield here to make sure the fork above is kicked off before we let Effect RPC finish the request
      yield* Effect.yieldNow()

      return SyncMessage.PushAck.make({})
    }).pipe(
      Effect.tap(
        Effect.fn(function* (message) {
          if (options?.onPushRes) {
            yield* Effect.tryAll(() => options.onPushRes!(message)).pipe(UnexpectedError.mapToUnexpectedError)
          }
        }),
      ),
      Effect.mapError((cause) => InvalidPushError.make({ cause })),
      Effect.withSpan('sync-cf:do:push', { attributes: { storeId, batchSize: pushRequest.batch.length } }),
    )

/**
 * @see https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile
 */
const blockConcurrencyWhile =
  (ctx: CfTypes.DurableObjectState) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<R>()
      const exit = yield* Effect.promise(() =>
        ctx.blockConcurrencyWhile(() => eff.pipe(Effect.provide(runtime), Effect.runPromiseExit)),
      )

      return yield* exit
    })
