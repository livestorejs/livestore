import type { LiveStoreEvent } from '@livestore/common/schema'
import { Chunk, Effect, FetchHttpClient, Layer, Mailbox, Stream } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { pullEventsFromSyncBackend, pushEventsToSyncBackend } from '../sync-operations.ts'
import { makeEventFactory, useMockConfig } from './fixtures/mock-config.ts'

const baseLayer = Layer.mergeAll(PlatformNode.NodeFileSystem.layer, FetchHttpClient.layer)
const withTestCtx = Vitest.makeWithTestCtx({ makeLayer: () => baseLayer })

/** Each test acquires its own temporary config module via useMockConfig, avoiding shared state. */
Vitest.describe('sync-operations', { timeout: 10_000 }, () => {
  const storeId = 'test-store'
  const clientId = 'test-client'

  /** Collects the connect + disconnect lifecycle emitted by the mock sync backend. */
  const expectConnectLifecycle = (
    mailbox: Mailbox.Mailbox<'connect' | 'disconnect'>,
  ): Effect.Effect<ReadonlyArray<'connect' | 'disconnect'>> =>
    Mailbox.toStream(mailbox).pipe(
      Stream.take(2),
      Stream.runCollect,
      Effect.map((chunk) => Chunk.toReadonlyArray(chunk)),
    )

  Vitest.scopedLive('exports events and releases the backend connection', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { mockBackend, connectionEvents, configPath } = yield* useMockConfig
      const factory = makeEventFactory()

      const batch = [
        factory.itemAdded.next({ id: 'e1', title: 'First' }),
        factory.itemAdded.next({ id: 'e2', title: 'Second' }),
      ]

      yield* mockBackend.advance(...batch)

      const result = yield* pullEventsFromSyncBackend({
        configPath,
        storeId,
        clientId,
      })

      expect(result.eventCount).toBe(2)
      expect(result.data.events).toHaveLength(2)

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('fails import when backend is not empty', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { mockBackend, connectionEvents, configPath } = yield* useMockConfig
      const factory = makeEventFactory()

      yield* mockBackend.advance(factory.itemAdded.next({ id: 'existing', title: 'Present' }))

      const importBatch = [
        factory.itemAdded.next({ id: 'incoming-1', title: 'Incoming' }),
        factory.itemAdded.next({ id: 'incoming-2', title: 'Incoming 2' }),
      ]

      const result = yield* pushEventsToSyncBackend({
        configPath,
        storeId,
        clientId,
        data: {
          version: 1,
          storeId,
          exportedAt: new Date().toISOString(),
          eventCount: importBatch.length,
          events: importBatch,
        },
        force: false,
        dryRun: false,
      }).pipe(Effect.either)

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('ImportError')
      }

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('supports dry-run import and releases backend', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { configPath, connectionEvents } = yield* useMockConfig
      const factory = makeEventFactory()
      const importBatch = [factory.itemAdded.next({ id: 'dry-run', title: 'Simulated' })]

      const result = yield* pushEventsToSyncBackend({
        configPath,
        storeId,
        clientId,
        data: {
          version: 1,
          storeId,
          exportedAt: new Date().toISOString(),
          eventCount: importBatch.length,
          events: importBatch,
        },
        force: false,
        dryRun: true,
      })

      expect(result.dryRun).toBe(true)
      expect(result.eventCount).toBe(importBatch.length)

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('imports events into empty backend with progress and batching', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { mockBackend, configPath, connectionEvents } = yield* useMockConfig
      const factory = makeEventFactory()
      const importBatch = Array.from({ length: 120 }, (_, idx) =>
        factory.itemAdded.next({ id: `id-${idx + 1}`, title: `Item ${idx + 1}` }),
      )

      const progress: Array<{ pushed: number; total: number }> = []

      const result = yield* pushEventsToSyncBackend({
        configPath,
        storeId,
        clientId,
        data: {
          version: 1,
          storeId,
          exportedAt: new Date().toISOString(),
          eventCount: importBatch.length,
          events: importBatch,
        },
        force: false,
        dryRun: false,
        onProgress: (pushed, total) => Effect.sync(() => progress.push({ pushed, total })),
      })

      expect(result.dryRun).toBe(false)
      expect(result.eventCount).toBe(importBatch.length)
      expect(progress).toEqual([
        { pushed: 100, total: 120 },
        { pushed: 120, total: 120 },
      ])

      const pushedEvents = yield* mockBackend.pushedEvents.pipe(
        Stream.take(importBatch.length),
        Stream.runCollect,
        Effect.map((chunk: Chunk.Chunk<LiveStoreEvent.Global.Encoded>) => Chunk.toReadonlyArray(chunk)),
      )
      expect(pushedEvents.map((event) => event.seqNum)).toHaveLength(importBatch.length)

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('allows force import on store ID mismatch', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { mockBackend, configPath, connectionEvents } = yield* useMockConfig
      const factory = makeEventFactory()
      const importBatch = [factory.itemAdded.next({ id: 'force-1', title: 'Force' })]

      const result = yield* pushEventsToSyncBackend({
        configPath,
        storeId,
        clientId,
        data: {
          version: 1,
          storeId: 'different-store',
          exportedAt: new Date().toISOString(),
          eventCount: importBatch.length,
          events: importBatch,
        },
        force: true,
        dryRun: false,
      })

      expect(result.dryRun).toBe(false)
      expect(result.eventCount).toBe(importBatch.length)

      const pushedEvents = yield* mockBackend.pushedEvents.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.map((chunk: Chunk.Chunk<LiveStoreEvent.Global.Encoded>) => Chunk.toReadonlyArray(chunk)),
      )
      expect(pushedEvents).toHaveLength(1)

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('rejects store ID mismatch without force', (test: Vitest.TestContext) =>
    Effect.gen(function* () {
      const { configPath, connectionEvents } = yield* useMockConfig
      const factory = makeEventFactory()
      const importBatch = [factory.itemAdded.next({ id: 'mismatch', title: 'Mismatch' })]

      const result = yield* pushEventsToSyncBackend({
        configPath,
        storeId,
        clientId,
        data: {
          version: 1,
          storeId: 'other-store',
          exportedAt: new Date().toISOString(),
          eventCount: importBatch.length,
          events: importBatch,
        },
        force: false,
        dryRun: false,
      }).pipe(Effect.either)

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('ImportError')
      }

      const lifecycle = yield* expectConnectLifecycle(connectionEvents)
      expect(lifecycle).toEqual(['connect', 'disconnect'])
    }).pipe(withTestCtx(test)),
  )
})
