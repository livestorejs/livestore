import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import { type CfTypes, layerProtocolDurableObject } from '@livestore/common-cf'
import {
  Effect,
  Layer,
  Option,
  Queue,
  RpcClient,
  RpcSerialization,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type { SyncBackendRpcInterface } from '../../cf-worker/shared.ts'
import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'

interface SyncBackendRpcStub extends CfTypes.DurableObjectStub, SyncBackendRpcInterface {}

export interface DoRpcSyncOptions {
  /** Durable Object stub that implements the SyncDoRpc interface */
  syncBackendStub: SyncBackendRpcStub
  /** Client identifier for subscription management */
  clientId: string
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
    clientId,
    durableObjectContext,
  }: DoRpcSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(true)

      // PubSub for incoming messages from RPC callbacks

      const ProtocolLive = layerProtocolDurableObject({
        callRpc: (payload) => syncBackendStub.rpc(payload),
        callerContext: durableObjectContext,
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const rpcClient = yield* RpcClient.make(SyncDoRpc).pipe(Effect.provide(ProtocolLive))

      // Nothing to do here
      const connect = Effect.void

      const pull: SyncBackend.SyncBackend<SyncMetadata>['pull'] = (args, options) =>
        Effect.gen(function* () {
          const initialCursor = Option.getOrUndefined(args)?.cursor
          const live = options?.live ?? false

          // const incomingMessages = yield* PubSub.unbounded<SyncBackend.PullResItem>()

          // Make runPull a function so it reads the current cursor value
          const runPull = (cursor: EventSequenceNumber.GlobalEventSequenceNumber | undefined) =>
            rpcClient.SyncDoRpc.Pull({
              cursor,
              live,
              storeId,
            }).pipe(
              Stream.mapError((cause) => new InvalidPullError({ cause })),
              Stream.tap((msg) => Effect.log(`RPC pulled ${msg.batch.length} events from sync provider`)),
              Stream.withSpan('rpc-sync-client:pull'),
            )

          if (live) {
            const messagesQueue = yield* Queue.unbounded<SyncBackend.PullResItem<SyncMetadata>>().pipe(
              Effect.acquireRelease(Queue.shutdown),
            )

            const cursorRef = { current: initialCursor }

            // Subscribe for future updates (but don't pull here)
            yield* rpcClient.SyncDoRpc.Subscribe({
              clientId,
              storeId,
              payload,
              callerContext: durableObjectContext,
            }).pipe(
              // Stream.tapLogWithLabel('rpc-sync-client:subscribe'),
              Stream.tap(() =>
                runPull(cursorRef.current).pipe(
                  Stream.tap((msg) =>
                    Effect.sync(() => {
                      if (msg.batch.length > 0) {
                        cursorRef.current = msg.batch.at(-1)!.eventEncoded.seqNum
                      }
                    }),
                  ),
                  Stream.tap((msg) => Queue.offer(messagesQueue, msg)),
                  Stream.runDrain,
                ),
              ),
              Stream.runDrain,
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            )

            // Do the initial pull
            yield* runPull(initialCursor).pipe(Stream.runDrain)

            return Stream.fromQueue(messagesQueue)
          } else {
            return runPull(initialCursor)
          }
        }).pipe(Stream.unwrapScoped, Stream.withSpan('rpc-sync-client:pull'))

      const push: SyncBackend.SyncBackend<{ createdAt: string }>['push'] = (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          yield* rpcClient.SyncDoRpc.Push({ batch, storeId })
        }).pipe(
          Effect.mapError((cause) => new InvalidPushError({ reason: { _tag: 'Unexpected', cause } })),
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
    })
