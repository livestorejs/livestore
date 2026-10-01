import { expect } from 'vitest'

import {
  makeMockSyncBackend,
  type MockSyncBackend,
  ServerAheadError,
  StateHead,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { events, schema } from '@livestore/livestore/internal/testing-utils'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { makeDoRpcSync, type SyncBackendRpcStub } from '@livestore/sync-cf/client'
import { SyncDoRpc, SyncMessage } from '@livestore/sync-cf/common'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Effect,
  FetchHttpClient,
  Layer,
  Option,
  Predicate,
  RpcSerialization,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const makeEventFactory = EventFactory.makeFactory(events)

/**
 * The replica wedge from #1462: a push parked on `ServerAheadError` waits for a pull chunk, so it can only resume
 * if a pull that failed on a temporary DO-RPC error is retried. Runs the real leader against the real DO-RPC
 * client; only the backend Durable Object is replaced by a mock behind the real `SyncDoRpc` handler.
 */
Vitest.describe('DO-RPC transport recovery', { timeout: 30_000 }, () => {
  Vitest.live('a push parked on ServerAheadError resumes once a retryable pull failure recovers', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: true })
      const otherClient = makeEventFactory({ client: EventFactory.clientIdentity('other-client', 'other-session') })
      yield* mockBackend.advance(otherClient.todoCreated.next({ id: 'remote', text: 'remote', completed: false }))

      const backend = yield* makeFlakyDoRpcBackend(mockBackend)

      yield* Effect.gen(function* () {
        const leader = yield* LeaderThreadCtx
        const localClient = makeEventFactory({ client: EventFactory.clientIdentity(leader.clientId, 'session') })

        // Same parent as the remote event, so the backend rejects this push until the leader pulls and rebases.
        yield* leader.syncProcessor.push([
          new LiveStoreEvent.Client.EncodedWithMeta(
            LiveStoreEvent.Global.toClientEncoded(
              localClient.todoCreated.next({ id: 'local', text: 'local', completed: false }),
            ),
          ),
        ])

        const pushed = yield* mockBackend.pushedEvents.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout('15 seconds'),
        )

        expect(pushed.map((event) => event.args)).toEqual([{ id: 'local', text: 'local', completed: false }])
        expect(backend.stats).toEqual({ rejectedPulls: 1, serverAheadPushes: 1 })
      }).pipe(Effect.provide(leaderLayer(backend.makeBackend)))
    }),
  )
})

const backendId = 'mock-backend'

/**
 * A DO-RPC backend over `mockBackend` whose first pull call is rejected the way Cloudflare rejects a call to a
 * restarting Durable Object.
 */
const makeFlakyDoRpcBackend = (mockBackend: MockSyncBackend) =>
  Effect.gen(function* () {
    const syncBackend = yield* mockBackend.makeSyncBackend
    const stats = { rejectedPulls: 0, serverAheadPushes: 0 }

    const handle = toDurableObjectHandler(SyncDoRpc, {
      layer: SyncDoRpc.toLayer({
        'SyncDoRpc.Pull': ({ cursor }) =>
          syncBackend
            .pull(
              cursor.pipe(Option.map(({ eventSequenceNumber }) => ({ eventSequenceNumber, metadata: Option.none() }))),
            )
            .pipe(
              Stream.map(({ batch, pageInfo }) => ({
                rpcRequestId: '0',
                batch: batch.map(({ eventEncoded }) => ({ eventEncoded, metadata: Option.none() })),
                pageInfo,
                backendId,
              })),
              Stream.mapError((cause) => (cause._tag === 'IsOfflineError' ? new UnknownError({ cause }) : cause)),
            ),
        'SyncDoRpc.Push': ({ batch }) =>
          syncBackend.push(batch).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (error instanceof ServerAheadError) stats.serverAheadPushes++
              }),
            ),
            Effect.as(SyncMessage.PushAck.make({})),
            Effect.mapError((cause) => (cause._tag === 'IsOfflineError' ? new UnknownError({ cause }) : cause)),
          ),
        'SyncDoRpc.Ping': () => Effect.void,
        'SyncDoRpc.Unsubscribe': () => Effect.void,
      }),
    })

    const rpc = (payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream> => {
      if (stats.rejectedPulls === 0 && requestTagOf(payload) === 'SyncDoRpc.Pull') {
        stats.rejectedPulls++
        return Promise.reject(Object.assign(new Error('Network connection lost.'), { retryable: true }))
      }
      return handle(new Uint8Array(payload)).pipe(Effect.runPromise)
    }

    const makeBackend = makeDoRpcSync({
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- a test double only needs `rpc`
      getSyncBackendStub: () => ({ rpc }) as unknown as SyncBackendRpcStub,
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- only live pulls read the DO state
      durableObjectState: {} as CfTypes.DurableObjectState,
      durableObjectContext: { bindingName: 'CLIENT_DO', durableObjectId: 'client-do' },
    })

    return { makeBackend, stats }
  })

const requestTagOf = (payload: Uint8Array) =>
  RpcSerialization.RpcSerialization.pipe(
    Effect.map((serialization) => serialization.makeUnsafe().decode(payload)[0]),
    Effect.map((message) => (Predicate.hasProperty(message, 'tag') === true ? message.tag : undefined)),
    Effect.provide(RpcSerialization.layerSchemaBinary()),
    Effect.runSync,
  )

const leaderLayer = (backend: SyncOptions['backend']) =>
  Effect.gen(function* () {
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

    return makeLeaderThreadLayer({
      schema,
      storeId: 'test',
      clientId: 'test',
      syncPayloadEncoded: undefined,
      syncPayloadSchema: undefined,
      makeSqliteDb,
      syncOptions: { backend, livePull: false },
      dbState,
      dbEventlog,
      devtoolsOptions: { enabled: false },
      shutdownChannel: yield* WebChannel.noopChannel<any, any>(),
    }).pipe(Layer.provide(StateHead.layer({ dbState })), Layer.provide(FetchHttpClient.layer))
  }).pipe(Layer.unwrap, Layer.provideMerge(PlatformNode.NodeFileSystem.layer))
