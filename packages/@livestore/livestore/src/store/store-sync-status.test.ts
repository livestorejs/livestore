import { expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { ClientSessionLeaderThreadProxy, makeMockSyncBackend } from '@livestore/common'
import { createStore } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, FetchHttpClient, Layer, References, Stream, Subscribable } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'

import { events, schema } from '../utils/tests/fixture.ts'
import type { SyncStatus } from './store-types.ts'

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () =>
    Layer.mergeAll(
      PlatformNode.NodeFileSystem.layer,
      FetchHttpClient.layer,
      Layer.succeed(References.MinimumLogLevel, 'Debug'),
    ),
})

Vitest.describe('Store sync status API', () => {
  Vitest.live('distinguishes leader acceptance from backend confirmation', (test) =>
    Effect.gen(function* () {
      const mockSyncBackend = yield* makeMockSyncBackend()
      const store = yield* createStore({
        schema,
        storeId: nanoid(),
        adapter: makeInMemoryAdapter({
          sync: { backend: () => mockSyncBackend.makeSyncBackend, onSyncError: 'shutdown' },
        }),
      })

      expect(store.syncStatus()).toMatchObject({
        pendingCount: 0,
        isSynced: true,
        backendHead: 'e0',
        backendPendingCount: 0,
        isBackendSynced: true,
      })

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      const awaitingBackend = yield* waitForStatus(
        store.syncStatusStream(),
        (status) => status.isSynced === true && status.backendPendingCount === 1,
      )
      expect(awaitingBackend).toMatchObject({
        pendingCount: 0,
        isSynced: true,
        backendHead: 'e0',
        backendPendingCount: 1,
        isBackendSynced: false,
      })

      yield* mockSyncBackend.connect

      const backendConfirmed = yield* waitForStatus(
        store.syncStatusStream(),
        (status) => status.isBackendSynced === true,
      )
      expect(backendConfirmed).toMatchObject({
        pendingCount: 0,
        isSynced: true,
        backendHead: 'e1',
        backendPendingCount: 0,
        isBackendSynced: true,
      })
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('does not report backend confirmation from a stale leader observation', (test) =>
    Effect.gen(function* () {
      const mockSyncBackend = yield* makeMockSyncBackend()
      const baseAdapter = makeInMemoryAdapter({
        sync: { backend: () => mockSyncBackend.makeSyncBackend, onSyncError: 'shutdown' },
      })
      const store = yield* createStore({
        schema,
        storeId: nanoid(),
        adapter: (args) =>
          baseAdapter(args).pipe(
            Effect.map((clientSession) => ({
              ...clientSession,
              leaderThread: ClientSessionLeaderThreadProxy.of(clientSession.leaderThread, {
                overrides: (original) => ({
                  syncState: Subscribable.make({ get: original.syncState, changes: Stream.never }),
                }),
              }),
            })),
          ),
      })

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      const sessionCaughtUp = yield* waitForStatus(
        store.syncStatusStream(),
        (status) => status.isSynced === true && status.upstreamHead !== 'e0',
      )

      expect(sessionCaughtUp).toMatchObject({
        pendingCount: 0,
        isSynced: true,
        backendHead: 'e0',
        backendPendingCount: 0,
        isBackendSynced: false,
      })
    }).pipe(withTestCtx(test)),
  )
})

const waitForStatus = (stream: Stream.Stream<SyncStatus>, predicate: (status: SyncStatus) => boolean) =>
  stream.pipe(Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption), Effect.timeout('5 seconds'))
