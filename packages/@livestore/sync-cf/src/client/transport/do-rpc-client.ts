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

type PushBatchItem = SyncMessage.PushRequest['batch'][number]

export interface SyncBackendRpcStub extends CfTypes.DurableObjectStub, SyncBackendRpcInterface {}

export interface DoRpcSyncOptions {
  /** Durable Object stub that implements the SyncDoRpc interface */
  syncBackendStub: SyncBackendRpcStub
  /**
   * State handle of the client DurableObject running this sync backend. Scopes live-pull routing to
   * this instance so it resets when the DO is reconstructed (see {@link handleSyncUpdateRpc}).
   */
  durableObjectState: CfTypes.DurableObjectState
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
  ({
    syncBackendStub,
    durableObjectState,
    durableObjectContext,
  }: DoRpcSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
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

                  const requestId = res.value.rpcRequestId
                  const routing = pullRoutingFor(durableObjectState)

                  const queue = yield* Effect.acquireRelease(Queue.unbounded<SyncMessage.PullResponse>(), (queue) =>
                    // Drop the routing entry on release so it can't outlive its (now shut-down) queue
                    Effect.sync(() => routing.delete(requestId)).pipe(Effect.andThen(Queue.shutdown(queue))),
                  )

                  routing.set(requestId, queue)

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
            encode: (items: ReadonlyArray<PushBatchItem>) => ({
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
 * Routes a reverse-RPC update from the sync backend into this client's live pull.
 *
 * The backend passes the subscription's `storeId` as a required trailing argument to
 * `syncUpdateRpc`, so a reconstructed (store-less) DO can re-boot its store — whose boot runs a
 * catch-up pull — before delivering. Skip the re-boot and a store-less wake drops the update.
 * `storeId` flows to your store boot, not into `handleSyncUpdateRpc` (routing doesn't need it).
 *
 * ```ts
 * import { DurableObject } from 'cloudflare:workers'
 * import { ClientDoWithRpcCallback } from '@livestore/common-cf'
 *
 * export class MyDurableObject extends DurableObject implements ClientDoWithRpcCallback {
 *   // ...
 *
 *   async syncUpdateRpc(payload: Uint8Array<ArrayBuffer>, storeId: string) {
 *     await this.getStore(storeId) // idempotent: re-boots + catches up when the DO was reconstructed
 *     return handleSyncUpdateRpc(this.ctx, payload)
 *   }
 * }
 * ```
 */
export const handleSyncUpdateRpc = (ctx: CfTypes.DurableObjectState, payload: Uint8Array<ArrayBuffer>) =>
  Effect.gen(function* () {
    const parser = RpcSerialization.msgPack.makeUnsafe()
    const decodedMessage = parser.decode(payload)
    const [response] = Array.isArray(decodedMessage) === true ? decodedMessage.flat(1) : [decodedMessage]
    const decodedPayload = yield* Schema.decodeUnknownEffect(ResponseChunkEncoded)(response)
    const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(SyncMessage.PullResponse))(
      decodedPayload.values[0],
    )

    const pullStreamQueue = pullRoutingFor(ctx).get(decodedPayload.requestId)

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

type EffectRpcRequestId = string // 0, 1, 2, ...
type PullRouting = Map<EffectRpcRequestId, Queue.Queue<SyncMessage.PullResponse>>

/**
 * Per-instance map from a live pull's request id to its response queue, keyed off the client DO's
 * `DurableObjectState` (not a module global) for two independent reasons:
 * - Per-instance: a reconstructed DO starts empty, so a reverse-RPC whose store is gone hits the
 *   `handleSyncUpdateRpc` drop branch (the recovery hook) instead of a stale queue that outlived it.
 * - Keyed by request id: a late chunk from a superseded pull generation finds no entry and is
 *   dropped here — never reaching `SyncState.merge`, which dies on an event at/below the upstream head.
 */
const pullRoutingByInstance = new WeakMap<CfTypes.DurableObjectState, PullRouting>()

const pullRoutingFor = (ctx: CfTypes.DurableObjectState): PullRouting => {
  const existing = pullRoutingByInstance.get(ctx)
  if (existing !== undefined) return existing
  const routing: PullRouting = new Map()
  pullRoutingByInstance.set(ctx, routing)
  return routing
}
