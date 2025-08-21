import { UnexpectedError } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Option, type RpcMessage, Schema } from '@livestore/utils/effect'
import { SyncMessage } from '../common/mod.ts'
import {
  type MakeDurableObjectClassOptions,
  type RpcSubscription,
  type StoreId,
  WebSocketAttachmentSchema,
} from './shared.ts'
import type { SyncStorage } from './sync-storage.ts'

export const makePush =
  ({
    storage,
    requestId,
    options,
    rpcSubscriptions,
    pushSemaphore,
    currentHeadRef,
    storeId,
    payload,
    ctx,
  }: {
    options: MakeDurableObjectClassOptions | undefined
    storage: SyncStorage
    requestId: string
    rpcSubscriptions: Map<StoreId, RpcSubscription>
    pushSemaphore: Effect.Semaphore
    currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
    storeId: StoreId
    payload: Schema.JsonValue | undefined
    ctx: CfTypes.DurableObjectState
  }) =>
  (decodedMessage: Omit<SyncMessage.PushRequest, '_tag'>) =>
    Effect.gen(function* () {
      // yield* Effect.log(`Pushing ${decodedMessage.batch.length} events`, decodedMessage.batch)

      if (decodedMessage.batch.length === 0) {
        return SyncMessage.PushAck.make({ requestId })
      }

      // TODO use ctx.blockConcurrencyWhile()

      yield* pushSemaphore.take(1)

      if (options?.onPush) {
        yield* Effect.tryAll(() => options.onPush!(decodedMessage as TODO, { storeId, payload })).pipe(
          UnexpectedError.mapToUnexpectedError,
        )
      }

      // TODO check whether we could use the Durable Object storage for this to speed up the lookup
      // const expectedParentNum = yield* storage.getHead
      // let currentHead: EventSequenceNumber.GlobalEventSequenceNumber
      if (currentHeadRef.current === 'uninitialized') {
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
      const firstEvent = decodedMessage.batch[0]!
      if (firstEvent.parentSeqNum !== currentHeadRef.current) {
        yield* pushSemaphore.release(1)

        return yield* SyncMessage.SyncError.make({
          cause: SyncMessage.InvalidParentEventNumber.make({
            expected: currentHeadRef.current,
            received: firstEvent.parentSeqNum,
          }),
          storeId,
        })
      }

      const createdAt = new Date().toISOString()

      // NOTE we're not waiting for this to complete yet to allow the broadcast to happen right away
      // while letting the async storage write happen in the background
      yield* storage.appendEvents(decodedMessage.batch, createdAt)
      // .pipe(Effect.forkScoped)

      // TODO update currentHead in storage
      currentHeadRef.current = decodedMessage.batch.at(-1)!.seqNum
      yield* Effect.promise(() => ctx.storage.put('currentHead', currentHeadRef.current))

      yield* pushSemaphore.release(1)

      // Run in background but already return the push ack to the client
      yield* Effect.gen(function* () {
        const connectedClients = ctx.getWebSockets()

        // Dual broadcasting: WebSocket + RPC clients
        const pullRes = SyncMessage.PullResponse.make({
          batch: decodedMessage.batch.map((eventEncoded) => ({
            eventEncoded,
            metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt })),
          })),
          remaining: 0,
          requestId: { context: 'push', requestId },
        })

        // Broadcast to WebSocket clients
        if (connectedClients.length > 0) {
          const pullResEnc = Schema.encodeSync(SyncMessage.PullResponse)(pullRes)

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
          // TODO re-write DO RPC to be poke-to-pull based (i.e. sync backend calls back to client DOs)
          console.debug(`RPC clients registered: ${rpcSubscriptions.size} (broadcasting not yet implemented)`)
        }

        // TODO double check forking is safe here and won't be interrupted by the RPC server
      }).pipe(Effect.fork)

      // We need to yield here to make sure the fork above is kicked off before we let Effect RPC finish the request
      yield* Effect.yieldNow()

      return SyncMessage.PushAck.make({ requestId })
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.tap(
        Effect.fn(function* (message) {
          if (options?.onPushRes) {
            yield* Effect.tryAll(() => options.onPushRes!(message)).pipe(UnexpectedError.mapToUnexpectedError)
          }
        }),
      ),
    )
