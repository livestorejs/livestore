import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import { splitChunkBySize } from '@livestore/common/sync'
import { type CfTypes, layerProtocolDurableObject } from '@livestore/common-cf'
import { omit, shouldNeverHappen } from '@livestore/utils'
import {
  Chunk,
  Effect,
  identity,
  Layer,
  Mailbox,
  Option,
  RpcClient,
  RpcSerialization,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type { SyncBackendRpcInterface } from '../../cf-worker/shared.ts'
import { MAX_DO_RPC_REQUEST_BYTES, MAX_PUSH_EVENTS_PER_REQUEST } from '../../common/constants.ts'
import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import { SyncMessage } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'

export interface SyncBackendRpcStub extends CfTypes.DurableObjectStub, SyncBackendRpcInterface {}

// TODO we probably need better scoping for the requestIdMailboxMap (i.e. support multiple stores, ...)
type EffectRpcRequestId = string // 0, 1, 2, ...
const requestIdMailboxMap = new Map<EffectRpcRequestId, Mailbox.Mailbox<SyncMessage.PullResponse>>()

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
        rpcClient.SyncDoRpc.Pull({
          cursor: cursor.pipe(
            Option.map((a) => ({
              eventSequenceNumber: a.eventSequenceNumber,
              backendId: backendIdHelper.get().pipe(Option.getOrThrow),
            })),
          ),
          storeId,
          rpcContext: options?.live ? { callerContext: durableObjectContext } : undefined,
        }).pipe(
          options?.live
            ? Stream.concatWithLastElement((res) =>
                Effect.gen(function* () {
                  if (res._tag === 'None')
                    return shouldNeverHappen('There should at least be a no-more page info response')

                  const mailbox = yield* Mailbox.make<SyncMessage.PullResponse>().pipe(
                    Effect.acquireRelease((mailbox) => mailbox.shutdown),
                  )

                  requestIdMailboxMap.set(res.value.rpcRequestId, mailbox)

                  return Mailbox.toStream(mailbox)
                }).pipe(Stream.unwrapScoped),
              )
            : identity,
          Stream.tap((res) => backendIdHelper.lazySet(res.backendId)),
          Stream.map((res) => omit(res, ['backendId'])),
          Stream.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause }))),
          Stream.withSpan('rpc-sync-client:pull'),
        )

      const push: SyncBackend.SyncBackend<{ createdAt: string }>['push'] = (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          const backendId = backendIdHelper.get()
          const batchChunks = yield* Chunk.fromIterable(batch).pipe(
            splitChunkBySize({
              maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
              maxBytes: MAX_DO_RPC_REQUEST_BYTES,
              encode: (items) => ({
                batch: items,
                storeId,
                backendId,
              }),
            }),
            Effect.mapError((cause) => new InvalidPushError({ cause: new UnexpectedError({ cause }) })),
          )

          for (const chunk of Chunk.toReadonlyArray(batchChunks)) {
            const chunkArray = Chunk.toReadonlyArray(chunk)
            yield* rpcClient.SyncDoRpc.Push({ batch: chunkArray, storeId, backendId })
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === 'InvalidPushError'
              ? cause
              : InvalidPushError.make({ cause: new UnexpectedError({ cause }) }),
          ),
          Effect.withSpan('rpc-sync-client:push'),
        )

      const ping: SyncBackend.SyncBackend<{ createdAt: string }>['ping'] = rpcClient.SyncDoRpc.Ping({
        storeId,
        payload,
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('rpc-sync-client:ping'))

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
    const decodedPayload = yield* Schema.decodeUnknown(ResponseChunkEncoded)(payload)
    const decoded = yield* Schema.decodeUnknown(SyncMessage.PullResponse)(decodedPayload.values[0]!)

    const pullStreamMailbox = requestIdMailboxMap.get(decodedPayload.requestId)

    if (pullStreamMailbox === undefined) {
      // Case: DO was hibernated, so we need to manually update the store
      yield* Effect.log(`No mailbox found for ${decodedPayload.requestId}`)
    } else {
      // Case: DO was still alive, so the existing `pull` will pick up the new events
      yield* pullStreamMailbox.offer(decoded)
    }
  }).pipe(Effect.withSpan('rpc-sync-client:rpcCallback'), Effect.tapCauseLogPretty, Effect.runPromise)

const ResponseChunkEncoded = Schema.Struct({
  requestId: Schema.String,
  values: Schema.Array(Schema.Any),
})
