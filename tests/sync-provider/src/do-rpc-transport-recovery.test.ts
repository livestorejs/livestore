import { expect } from 'vitest'

import {
  EventlogSqliteDb,
  makeMockSyncBackend,
  MaterializationJournal,
  type MockSyncBackend,
  ServerAheadError,
  StateHead,
  StateSqliteDb,
  SyncBackend,
  type SyncOptions,
  UnknownError,
} from '@livestore/common'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { events, schema, tables } from '@livestore/livestore/internal/testing-utils'
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
  Vitest.live('resumes after the last applied event when a pull stream breaks', () =>
    Effect.gen(function* () {
      const remote = makeEventFactory({ client: EventFactory.clientIdentity('remote', 'session') })
      const eventA = remote.todoCreated.next({ id: 'a', text: 'A', completed: false })
      const eventB = remote.todoCreated.next({ id: 'b', text: 'B', completed: false })
      const requestedCursors: Array<number | undefined> = []
      const handle = toDurableObjectHandler(SyncDoRpc, {
        layer: SyncDoRpc.toLayer({
          'SyncDoRpc.Pull': ({ cursor }) => {
            const after = Option.getOrUndefined(cursor)?.eventSequenceNumber
            requestedCursors.push(after)
            return Stream.make({
              rpcRequestId: '0',
              backendId,
              batch: [{ eventEncoded: after === undefined ? eventA : eventB, metadata: Option.none() }],
              pageInfo: after === undefined ? SyncBackend.pageInfoMoreUnknown : SyncBackend.pageInfoNoMore,
            })
          },
          'SyncDoRpc.Push': () => Effect.succeed(SyncMessage.PushAck.make({})),
          'SyncDoRpc.Ping': () => Effect.void,
          'SyncDoRpc.Unsubscribe': () => Effect.void,
        }),
      })
      let firstCall = true
      const rpc = async (payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream> => {
        const response = await handle(new Uint8Array(payload)).pipe(Effect.runPromise)
        if (firstCall === false || response instanceof Uint8Array) return response
        firstCall = false
        return breakAfterFirstPage(response)
      }
      const makeBackend = makeDoRpcSync({
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- the test stub only needs rpc
        getSyncBackendStub: () => ({ rpc }) as unknown as SyncBackendRpcStub,
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- this test does not use live callbacks
        durableObjectState: {} as CfTypes.DurableObjectState,
        durableObjectContext: { bindingName: 'CLIENT_DO', durableObjectId: 'client' },
      })

      yield* Effect.gen(function* () {
        const leader = yield* LeaderThreadCtx
        const appliedHeads = yield* leader.syncProcessor.syncState.changes.pipe(
          Stream.map((state) => state.upstreamHead.global),
          Stream.changes,
          Stream.takeUntil((head) => head === eventB.seqNum),
          Stream.runCollect,
          Effect.timeout('5 seconds'),
        )

        expect(requestedCursors).toEqual([undefined, eventA.seqNum])
        expect(appliedHeads.filter((head) => head > 0)).toEqual([eventA.seqNum, eventB.seqNum])
        expect((yield* StateSqliteDb.StateSqliteDb).select(tables.todos.orderBy('id', 'asc'))).toEqual([
          { id: 'a', text: 'A', completed: false },
          { id: 'b', text: 'B', completed: false },
        ])
      }).pipe(Effect.provide(leaderLayer(makeBackend)))
    }),
  )

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
          LiveStoreEvent.Global.toClientEncoded(
            localClient.todoCreated.next({ id: 'local', text: 'local', completed: false }),
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

/** Keep the first encoded page and replace the RPC exit with a connection failure. */
const breakAfterFirstPage = async (response: CfTypes.ReadableStream): Promise<CfTypes.ReadableStream> => {
  const reader = response.getReader()
  const { value } = await reader.read()
  await reader.cancel()
  reader.releaseLock()
  let sentPage = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sentPage === true)
        return controller.error(new Error('ReadableStream received over RPC disconnected prematurely.'))
      sentPage = true
      controller.enqueue(value)
    },
  })
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge the platform stream to the CF type
  return stream as unknown as CfTypes.ReadableStream
}

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
    const sqliteDbLayer = Layer.mergeAll(StateSqliteDb.layer(dbState), EventlogSqliteDb.layer(dbEventlog))
    const stateServicesLayer = Layer.mergeAll(StateHead.layer, MaterializationJournal.layer).pipe(
      Layer.provide(sqliteDbLayer),
    )

    return makeLeaderThreadLayer({
      schema,
      storeId: 'test',
      clientId: 'test',
      syncPayloadEncoded: undefined,
      syncPayloadSchema: undefined,
      makeSqliteDb,
      syncOptions: { backend, livePull: false },
      devtoolsOptions: { enabled: false },
      shutdownChannel: yield* WebChannel.noopChannel<any, any>(),
    }).pipe(
      Layer.provide(Layer.mergeAll(sqliteDbLayer, stateServicesLayer, FetchHttpClient.layer)),
      Layer.provideMerge(sqliteDbLayer),
    )
  }).pipe(Layer.unwrap, Layer.provideMerge(PlatformNode.NodeFileSystem.layer))
