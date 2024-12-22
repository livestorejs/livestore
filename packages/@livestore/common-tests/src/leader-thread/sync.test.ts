import '@livestore/utils/node-vitest-polyfill'

import {
  makeNextMutationEventIdPair,
  type MakeSynchronousDatabase,
  ROOT_ID,
  type SyncBackend,
  UnexpectedError,
  validatePushPayload,
} from '@livestore/common'
import { LeaderThreadCtx, makeApplyMutation, makeLeaderThread } from '@livestore/common/leader-thread'
import type { MutationEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import type { Scope } from '@livestore/utils/effect'
import {
  Config,
  Context,
  Effect,
  FetchHttpClient,
  identity,
  Layer,
  Logger,
  Option,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { OtelLiveHttp, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import { schema, tables } from './fixture.js'

/*
TODO:
- batch queued mutations which are about to be pushed
- rebase handling
- throughput metrics
- rebase thrashing tests
  - general idea: make rebase take 10ms but cause new pull events every 5ms
- benchmarks
  - 10.000 mutations
  - 100.000 mutations
- expose sync state: number of events left to pull + push
- make connected state settable
*/

Vitest.describe('sync', () => {
  Vitest.scopedLive('sync', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* testContext.mutate(tables.todos.insert({ id: '1', text: 't1', completed: false }))
      yield* testContext.mutate(tables.todos.insert({ id: '2', text: 't2', completed: false }))

      const result = leaderThreadCtx.db.select(tables.todos.query.asSql().query)

      expect(result).toEqual([
        { id: '1', text: 't1', completed: 0 },
        { id: '2', text: 't2', completed: 0 },
      ])

      yield* Effect.sleep(20)

      expect(testContext.pushedMutationEvents.length).toEqual(1)
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('invalid push', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* SubscriptionRef.set(testContext.syncIsConnectedRef, false)

      testContext.syncEventIdRef.current = 0
      yield* testContext.syncPullQueue.offer(
        testContext.encodeMutationEvent({
          ...tables.todos.insert({ id: '1', text: 't1', completed: false }),
          id: { global: 0, local: 0 },
          parentId: ROOT_ID,
        }),
      )

      yield* testContext.mutate(tables.todos.insert({ id: '2', text: 't2', completed: false }))

      yield* Effect.sleep(20)

      yield* SubscriptionRef.set(testContext.syncIsConnectedRef, true)

      const result = leaderThreadCtx.db.select(tables.todos.query.asSql().query)

      expect(result).toEqual([{ id: '2', text: 't2', completed: 0 }])

      yield* Effect.sleep(20)

      // expect(testContext.pushedMutationEvents.length).toEqual(1)
    }).pipe(withCtx(test)),
  )
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    pushedMutationEvents: MutationEvent.AnyEncoded[]
    syncEventIdRef: { current: number }
    syncPullQueue: Queue.Queue<MutationEvent.AnyEncoded>
    syncIsConnectedRef: SubscriptionRef.SubscriptionRef<boolean>
    encodeMutationEvent: (partialEvent: MutationEvent.Any) => MutationEvent.AnyEncoded
    mutate: (partialEvent: MutationEvent.PartialAny) => Effect.Effect<void, UnexpectedError, Scope.Scope>
  }
>() {}

const LeaderThreadCtxLive = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
    Effect.withSpan('@livestore/node:leader-thread:loadSqlite3Wasm'),
  )

  const makeSyncDb = (yield* syncDbFactory({ sqlite3 })) as MakeSynchronousDatabase
  const storeId = 'test'
  const originId = 'test'

  const db = yield* makeSyncDb({ _tag: 'in-memory' })
  const dbLog = yield* makeSyncDb({ _tag: 'in-memory' })

  const syncEventIdRef = { current: -1 }
  const syncPullQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>()
  const pushedMutationEvents: MutationEvent.AnyEncoded[] = []
  const syncIsConnectedRef = yield* SubscriptionRef.make(true)

  const makeSyncBackend = Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(1)
    return {
      isConnected: syncIsConnectedRef,
      pull: () =>
        Stream.fromQueue(syncPullQueue).pipe(
          Stream.chunks,
          Stream.map((chunk) => ({
            items: [...chunk].map((mutationEventEncoded) => ({
              mutationEventEncoded,
              metadata: Option.none(),
              persisted: true,
            })),
            remaining: 0,
          })),
          Stream.withSpan('mock-sync-backend:pull'),
        ),
      push: (batch) =>
        Effect.gen(function* () {
          yield* validatePushPayload(batch, syncEventIdRef.current)

          yield* Effect.sleep(10) // Simulate network latency

          pushedMutationEvents.push(...batch)

          syncEventIdRef.current = batch.at(-1)!.id.global

          return { metadata: Array.from({ length: batch.length }, () => Option.none()) }
        }).pipe(Effect.withSpan('mock-sync-backend:push'), semaphore.withPermits(1)),
    } satisfies SyncBackend
  })

  const leaderContextLayer = makeLeaderThread({
    schema,
    storeId,
    originId,
    makeSyncDb,
    makeSyncBackend,
    db,
    dbLog,
    devtoolsEnabled: false,
    initialSyncOptions: { _tag: 'Skip' },
  })

  const testContextLayer = Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx

    const encodeMutationEvent = Schema.encodeSync(leaderThreadCtx.mutationEventSchema)

    const currentMutationEventId = { current: ROOT_ID }
    const nextMutationEventIdPair = makeNextMutationEventIdPair(currentMutationEventId)

    const toEncodedMutationEvent = (partialEvent: MutationEvent.PartialAny) =>
      encodeMutationEvent({
        ...partialEvent,
        ...nextMutationEventIdPair({ localOnly: false }),
      }) satisfies MutationEvent.AnyEncoded

    const applyMutation = yield* makeApplyMutation(() => new Date().toISOString(), leaderThreadCtx.db)

    const mutate = (partialEvent: MutationEvent.PartialAny) =>
      Effect.gen(function* () {
        yield* applyMutation(toEncodedMutationEvent(partialEvent), {
          shouldBroadcast: true,
          persisted: true,
          inTransaction: true,
          syncStatus: 'pending',
          syncMetadataJson: Option.none(),
        }).pipe(UnexpectedError.mapToUnexpectedError)
      }).pipe(Effect.provide(FetchHttpClient.layer))

    return Layer.succeed(TestContext, {
      pushedMutationEvents,
      syncEventIdRef,
      syncPullQueue,
      syncIsConnectedRef,
      encodeMutationEvent,
      mutate,
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(leaderContextLayer))

  return leaderContextLayer.pipe(Layer.merge(testContextLayer))
}).pipe(Layer.unwrapScoped)

const isCi = Config.boolean('CI').pipe(
  Effect.catchAll(() => Effect.succeed(false)),
  Effect.runSync,
)

const otelLayer = isCi ? Layer.empty : OtelLiveHttp({ serviceName: 'sync-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(isCi ? 60_000 : 10_000),
      Effect.provide(LeaderThreadCtxLive),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
