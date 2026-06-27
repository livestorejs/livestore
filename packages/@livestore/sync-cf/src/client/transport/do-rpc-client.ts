import { SyncBackend, UnknownError } from '@livestore/common'
import { type CfTypes, layerProtocolDurableObject } from '@livestore/common-cf'
import { splitArrayBySize } from '@livestore/common/sync'
import { shouldNeverHappen } from '@livestore/utils'
import {
  Effect,
  identity,
  Layer,
  Option,
  Queue,
  ReadonlyArray as EffectArray,
  RpcClient,
  RpcSerialization,
  Schema,
  Stream,
  Struct,
  SubscriptionRef,
} from '@livestore/utils/effect'

import type { SyncBackendRpcInterface } from '../../cf-worker/shared.ts'
import { MAX_DO_RPC_REQUEST_BYTES, MAX_PUSH_EVENTS_PER_REQUEST } from '../../common/constants.ts'
import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import { SyncMessage } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'

export interface SyncBackendRpcStub extends CfTypes.DurableObjectStub, SyncBackendRpcInterface {}

// TODO we probably need better scoping for the requestIdQueueMap (i.e. support multiple stores, ...)
type EffectRpcRequestId = string // 0, 1, 2, ...
const requestIdQueueMap = new Map<EffectRpcRequestId, Queue.Queue<SyncMessage.PullResponse>>()

export interface DoRpcSyncOptions {
  /** Durable Object stub that implements the SyncDoRpc interface */
  syncBackendStub: SyncBackendRpcStub
  /** Information about this DurableObject instance so the Sync DO instance can call back to this instance */
  durableObjectContext: {
    /** See `wrangler.toml` for the binding name */
    bindingName: string
    /** `state.id.toString()` in the DO */
    durableObjectId: string
  }
}

/**
 * Creates a sync backend that uses Durable Object RPC to communicate with the sync backend.
 *
 * Used internally by `@livestore/adapter-cf` to connect to the sync backend.
 */
export const makeDoRpcSync =
  ({ syncBackendStub, durableObjectContext }: DoRpcSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(true)

      const ProtocolLive = layerProtocolDurableObject({
        callRpc: (payload) => syncBackendStub.rpc(payload),
        callerContext: durableObjectContext,
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const context = yield* Layer.build(ProtocolLive)

      const rpcClient = yield* RpcClient.make(SyncDoRpc).pipe(Effect.provide(context))

      // Nothing to do here
      const connect = Effect.void

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      const pull: SyncBackend.SyncBackend<SyncMetadata>['pull'] = (cursor, options) =>
        rpcClient['SyncDoRpc.Pull']({
          cursor: cursor.pipe(
            Option.map((a) => ({
              eventSequenceNumber: a.eventSequenceNumber,
              backendId: backendIdHelper.get().pipe(Option.getOrThrow),
            })),
          ),
          storeId,
          rpcContext: options?.live === true ? { callerContext: durableObjectContext } : undefined,
        }).pipe(
          options?.live === true
            ? Stream.concatWithLastElement((res) =>
                Effect.gen(function* () {
                  if (res._tag === 'None')
                    return shouldNeverHappen('There should at least be a no-more page info response')

                  const queue = yield* Effect.acquireRelease(
                    Queue.unbounded<SyncMessage.PullResponse>(),
                    (queue) => Queue.shutdown(queue).pipe(Effect.asVoid),
                  )

                  requestIdQueueMap.set(res.value.rpcRequestId, queue)

                  return Stream.fromQueue(queue)
                }).pipe(Stream.unwrap),
              )
            : identity,
          Stream.tap((res) => backendIdHelper.lazySet(res.backendId)),
          Stream.map((res) => Struct.omit(res, ['backendId'])),
          Stream.mapError((cause) =>
            cause._tag === 'UnknownError' || cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
          Stream.withSpan('rpc-sync-client:pull'),
        )

      const push: SyncBackend.SyncBackend<{ createdAt: string }>['push'] = Effect.fn('rpc-sync-client:push')(
        function* (batch) {
          if (batch.length === 0) {
            return
          }

          const backendId = backendIdHelper.get()
          if (EffectArray.isReadonlyArrayNonEmpty(batch) === false) {
            return
          }

          const batchChunks = yield* splitArrayBySize({
            maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
            maxBytes: MAX_DO_RPC_REQUEST_BYTES,
            encode: (items) => ({
              batch: items,
              storeId,
              backendId,
            }),
          })(batch).pipe(Effect.mapError((cause) => new UnknownError({ cause })))

          for (const batchChunk of batchChunks) {
            yield* rpcClient['SyncDoRpc.Push']({ batch: batchChunk, storeId, backendId })
          }
        },
        Effect.mapError((cause) =>
          cause._tag === 'UnknownError' || cause._tag === 'ServerAheadError' || cause._tag === 'BackendIdMismatchError'
            ? cause
            : new UnknownError({ cause }),
        ),
      )

      const ping: SyncBackend.SyncBackend<{ createdAt: string }>['ping'] = rpcClient['SyncDoRpc.Ping']({
        storeId,
        payload,
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('rpc-sync-client:ping'))

      return SyncBackend.of({
        connect,
        isConnected,
        pull,
        push,
        ping,
        metadata: {
          name: 'rpc-sync-client',
          description: 'Cloudflare Durable Object RPC Sync Client',
          protocol: 'rpc',
          storeId,
        },
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    }).pipe(Effect.withSpan('rpc-sync-client:makeDoRpcSync'))

/**
 *
 * ```ts
 * import { DurableObject } from 'cloudflare:workers'
 * import { ClientDoWithRpcCallback } from '@livestore/common-cf'
 *
 * export class MyDurableObject extends DurableObject implements ClientDoWithRpcCallback {
 *   // ...
 *
 *   async syncUpdateRpc(payload: RpcMessage.ResponseChunkEncoded) {
 *     return handleSyncUpdateRpc(payload)
 *   }
 * }
 * ```
 */
export const handleSyncUpdateRpc = (payload: unknown) =>
  Effect.gen(function* () {
    const decodedPayload = yield* Schema.decodeUnknownEffect(ResponseChunkEncoded)(payload)
    const decoded = yield* Schema.decodeUnknownEffect(SyncMessage.PullResponse)(decodedPayload.values[0])

    const pullStreamQueue = requestIdQueueMap.get(decodedPayload.requestId)

    if (pullStreamQueue === undefined) {
      // Case: DO was hibernated, so we need to manually update the store
      yield* Effect.log(`No pull stream queue found for ${decodedPayload.requestId}`)
    } else {
      // Case: DO was still alive, so the existing `pull` will pick up the new events
      yield* Queue.offer(pullStreamQueue, decoded)
    }
  }).pipe(Effect.withSpan('rpc-sync-client:rpcCallback'), Effect.tapCauseLogPretty, Effect.runPromise)

const ResponseChunkEncoded = Schema.Struct({
  requestId: Schema.String,
  values: Schema.Array(Schema.Any),
})
