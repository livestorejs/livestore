import { SyncBackend, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { type CfTypes, emitStreamResponse } from '@livestore/common-cf'
import { Effect, Option, type RpcMessage, Schema } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import {
  type Env,
  type MakeDurableObjectClassOptions,
  type RpcSubscription,
  type StoreId,
  WebSocketAttachmentSchema,
} from '../shared.ts'
import type { SyncStorage } from './sync-storage.ts'

export const makePush =
  ({
    storage,
    options,
    rpcSubscriptions,
    currentHeadRef,
    storeId,
    payload,
    ctx,
    env,
  }: {
    options: MakeDurableObjectClassOptions | undefined
    storage: SyncStorage
    rpcSubscriptions: Map<StoreId, RpcSubscription>
    currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
    storeId: StoreId
    payload: Schema.JsonValue | undefined
    ctx: CfTypes.DurableObjectState
    env: Env
  }) =>
  (pushRequest: Omit<SyncMessage.PushRequest, '_tag'>) =>
    Effect.gen(function* () {
      // yield* Effect.log(`Pushing ${decodedMessage.batch.length} events`, decodedMessage.batch)

      if (pushRequest.batch.length === 0) {
        return SyncMessage.PushAck.make({})
      }

      if (options?.onPush) {
        yield* Effect.tryAll(() => options.onPush!(pushRequest, { storeId, payload })).pipe(
          UnexpectedError.mapToUnexpectedError,
        )
      }

      // This part of the code needs to run sequentially to avoid race conditions
      const { createdAt } = yield* Effect.gen(function* () {
        // TODO check whether we could use the Durable Object storage for this to speed up the lookup
        // const expectedParentNum = yield* storage.getHead
        // let currentHead: EventSequenceNumber.GlobalEventSequenceNumber
        if (currentHeadRef.current === 'uninitialized') {
          // TODO move into cachedStorage (i.e. use sqlite for sync api)
          const currentHeadFromStorage = yield* Effect.promise(() => ctx.storage.get('currentHead'))
          // console.log('currentHeadFromStorage', currentHeadFromStorage)
          if (currentHeadFromStorage === undefined) {
            // console.log('currentHeadFromStorage is null, getting from D1')
            // currentHead = yield* storage.getHead
            // console.log('currentHeadFromStorage is null, using root')
            currentHeadRef.current = EventSequenceNumber.ROOT.global
          } else {
            currentHeadRef.current = currentHeadFromStorage as EventSequenceNumber.GlobalEventSequenceNumber
          }
        } else {
          // console.log('currentHead is already initialized', this.currentHead)
          // currentHead = this.currentHead
        }

        // TODO handle clientId unique conflict
        // Validate the batch
        const firstEvent = pushRequest.batch[0]!
        if (firstEvent.parentSeqNum !== currentHeadRef.current) {
          return yield* SyncMessage.SyncError.make({
            cause: SyncMessage.InvalidParentEventNumber.make({
              expected: currentHeadRef.current,
              received: firstEvent.parentSeqNum,
            }),
            storeId,
          })
        }

        const createdAt = new Date().toISOString()

        // TODO possibly model this as a queue in order to speed up subsequent pushes
        yield* storage.appendEvents(pushRequest.batch, createdAt)

        // TODO update currentHead in storage
        currentHeadRef.current = pushRequest.batch.at(-1)!.seqNum
        yield* Effect.promise(() => ctx.storage.put('currentHead', currentHeadRef.current))

        return { createdAt }
      }).pipe(blockConcurrencyWhile(ctx))

      // Run in background but already return the push ack to the client
      yield* Effect.gen(function* () {
        const connectedClients = ctx.getWebSockets()

        // Dual broadcasting: WebSocket + RPC clients
        const pullRes = SyncMessage.PullResponse.make({
          batch: pushRequest.batch.map((eventEncoded) => ({
            eventEncoded,
            metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt })),
          })),
          pageInfo: SyncBackend.pageInfoNoMore,
        })

        const pullResEnc = Schema.encodeSync(SyncMessage.PullResponse)(pullRes)

        // Broadcast to WebSocket clients
        if (connectedClients.length > 0) {
          // Only calling once for now.
          if (options?.onPullRes) {
            yield* Effect.tryAll(() => options.onPullRes!(pullRes)).pipe(UnexpectedError.mapToUnexpectedError)
          }

          // NOTE we're also sending the pullRes to the pushing ws client as a confirmation
          for (const conn of connectedClients) {
            // conn.send(pullResEnc)
            const attachment = Schema.decodeSync(WebSocketAttachmentSchema)(conn.deserializeAttachment())

            // We're doing something a bit "advanced" here as we're directly emitting Effect RPC-compatible
            // response messsages on the Effect RPC-managed websocket connection to the WS client.
            // For this we need to get the RPC `requestId` from the WebSocket attachment.
            for (const requestId of attachment.pullRequestIds) {
              const res: RpcMessage.ResponseChunkEncoded = {
                _tag: 'Chunk',
                requestId,
                values: [pullResEnc],
              }
              conn.send(JSON.stringify(res))
            }
          }

          yield* Effect.logDebug(`Broadcasted to ${connectedClients.length} WebSocket clients`)
        }

        // RPC broadcasting would require reconstructing client stubs from clientIds
        // For now, we'll implement this later when we have the proper client registry
        if (rpcSubscriptions.size > 0) {
          for (const subscription of rpcSubscriptions.values()) {
            yield* emitStreamResponse({
              callerContext: subscription.callerContext,
              env,
              requestId: subscription.requestId,
              values: [pullResEnc],
            })
          }

          // TODO re-write DO RPC to be poke-to-pull based (i.e. sync backend calls back to client DOs)
          yield* Effect.logDebug(`RPC clients registered: ${rpcSubscriptions.size}`)
        }
      }).pipe(Effect.fork)

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
      Effect.mapError((cause) =>
        cause._tag === 'LiveStore.UnexpectedError' ? SyncMessage.SyncError.make({ cause, storeId }) : cause,
      ),
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
