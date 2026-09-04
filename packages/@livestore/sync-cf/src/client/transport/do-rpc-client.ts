import { SyncBackend, UnknownError } from '@livestore/common'
import {
  type CfTypes,
  layerProtocolDurableObject,
  type SyncUpdateAck,
  type SyncUpdateCallback,
} from '@livestore/common-cf'
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
  type RpcMessage,
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
   * State handle of the client DurableObject running this sync backend. Mints the live-pull callback stub via
   * `ctx.restore` (needs the `allow_irrevocable_stub_storage` compatibility flag on both Workers) and scopes
   * live-pull routing to this instance so it resets when the DO is reconstructed (see {@link handleSyncUpdateRpc}).
   */
  durableObjectState: CfTypes.DurableObjectState
}

/** What a client DO's `[restore]` receives for a live-pull callback. */
export const SyncUpdateRestoreParams = Schema.Struct({ storeId: Schema.String, subscriptionId: Schema.String })
export type SyncUpdateRestoreParams = typeof SyncUpdateRestoreParams.Type

/**
 * Creates a sync backend that uses Durable Object RPC to communicate with the sync backend.
 *
 * Used internally by `@livestore/adapter-cf` to connect to the sync backend.
 */
export const makeDoRpcSync =
  ({
    syncBackendStub,
    durableObjectState: state,
  }: DoRpcSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(true)
      const durableObjectState = yield* restorableState(state)

      const callLivePull = async (payload: Uint8Array, params: SyncUpdateRestoreParams) => {
        // The marker makes `[restore]` accept only this store's newest live pull; superseded ones are refused.
        durableObjectState.storage.kv.put(activeSubscriptionKey(params.storeId), params.subscriptionId)
        const callback = await durableObjectState.restore(params)
        try {
          return await syncBackendStub.rpc(payload, callback)
        } finally {
          // The backend stored its own copy; ours would otherwise keep the session (and both DOs) alive.
          callback[Symbol.dispose]()
        }
      }

      const ProtocolLive = layerProtocolDurableObject({
        callRpc: (payload, request) => {
          const live = livePullParamsOf(request)
          return live === undefined ? syncBackendStub.rpc(payload) : callLivePull(payload, live)
        },
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const context = yield* Layer.build(ProtocolLive)

      const rpcClient = yield* RpcClient.make(SyncDoRpc).pipe(Effect.provide(context))

      // Nothing to do here
      const connect = Effect.void

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      const pull: SyncBackend.SyncBackend<SyncMetadata>['pull'] = (cursor, options) => {
        const subscriptionId = options?.live === true ? crypto.randomUUID() : undefined
        return rpcClient['SyncDoRpc.Pull']({
          cursor: cursor.pipe(
            Option.map((a) => ({
              eventSequenceNumber: a.eventSequenceNumber,
              backendId: backendIdHelper.get().pipe(Option.getOrThrow),
            })),
          ),
          storeId,
          live: subscriptionId === undefined ? undefined : { subscriptionId },
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

                  // Graceful shutdown only (eviction runs no finalizers). Clearing the marker first makes a late
                  // delivery refuse, so the row is dropped even if the unsubscribe itself is lost.
                  yield* Effect.addFinalizer(() =>
                    Effect.gen(function* () {
                      const key = activeSubscriptionKey(storeId)
                      if (durableObjectState.storage.kv.get(key) === subscriptionId) {
                        durableObjectState.storage.kv.delete(key)
                      }
                      yield* rpcClient['SyncDoRpc.Unsubscribe']({ storeId, subscriptionId: subscriptionId! }).pipe(
                        Effect.timeout('5 seconds'),
                        Effect.tapCauseLogPretty,
                        Effect.ignore,
                      )
                    }),
                  )

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
      }

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
 * Builds the `deliver` function behind a client DO's `[restore]` for the given restore params. It refuses (so
 * the backend drops the row) when the subscription is no longer the store's active live pull. `onUpdate` runs
 * before routing and lets a rebuilt DO reload its store; booting a store starts a new live pull, which also
 * supersedes the row that woke the DO.
 *
 * `@livestore/adapter-cloudflare` wraps this in an `RpcTarget`; use `restoreStoreDoSyncTarget` from there.
 */
export const makeSyncUpdateDeliver = (
  ctx: CfTypes.DurableObjectState,
  params: unknown,
  options?: { onUpdate?: (storeId: string) => Promise<unknown> },
): ((payload: Uint8Array<ArrayBuffer>) => Promise<SyncUpdateAck>) => {
  const { storeId, subscriptionId } = Schema.decodeUnknownSync(SyncUpdateRestoreParams)(params)
  const isActive = () => ctx.storage.kv.get(activeSubscriptionKey(storeId)) === subscriptionId
  return async (payload) => {
    if (isActive() === false) return { refused: true }
    await options?.onUpdate?.(storeId)
    if (isActive() === false) return { refused: true }
    await handleSyncUpdateRpc(ctx, payload)
    return { refused: false }
  }
}

/** Routes an update from the sync backend into this client's live pull (see {@link makeSyncUpdateDeliver}). */
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

/**
 * `DurableObjectState.restore` (persistent stubs) exists in workerd since 2026-05 but is only typed in the
 * `experimental` entry of `@cloudflare/workers-types`, so the capability is checked at runtime here.
 */
interface RestorableDurableObjectState extends CfTypes.DurableObjectState {
  restore(params: SyncUpdateRestoreParams): Promise<SyncUpdateCallback>
}

const restorableState = (state: CfTypes.DurableObjectState) =>
  'restore' in state && typeof state.restore === 'function'
    ? // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- narrowed by the runtime check above
      Effect.succeed(state as RestorableDurableObjectState)
    : Effect.die(
        'DO-RPC live pull needs Cloudflare persistent stubs: enable the `allow_irrevocable_stub_storage` compatibility flag on this Worker and on the sync backend Worker',
      )

/** KV key holding the subscription id of the store's current live pull on this client DO. */
const activeSubscriptionKey = (storeId: string) => `livestore-rpc-sub:${storeId}`

const LivePullRequestPayload = Schema.Struct({
  storeId: Schema.String,
  live: Schema.Struct({ subscriptionId: Schema.String }),
})

const livePullParamsOf = (request: RpcMessage.RequestEncoded): SyncUpdateRestoreParams | undefined => {
  if (request.tag !== 'SyncDoRpc.Pull') return undefined
  const decoded = Schema.decodeUnknownOption(LivePullRequestPayload)(request.payload)
  return Option.isSome(decoded) === true
    ? { storeId: decoded.value.storeId, subscriptionId: decoded.value.live.subscriptionId }
    : undefined
}

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
