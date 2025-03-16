import '@livestore/utils/node-vitest-polyfill'

import type { LeaderAheadError, MakeSqliteDb, UnexpectedError } from '@livestore/common'
import type { PullQueueItem } from '@livestore/common/leader-thread'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { EventId, MutationEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { IS_CI } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import {
  Chunk,
  Context,
  Effect,
  FetchHttpClient,
  identity,
  Layer,
  Logger,
  Queue,
  Schema,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'
import { OtelLiveHttp, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import type { MockSyncBackend } from '../mock-sync-backend.js'
import { makeMockSyncBackend } from '../mock-sync-backend.js'
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

Vitest.describe('LeaderSyncProcessor', () => {
  Vitest.scopedLive('sync', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* testContext.localPush(
        tables.todos.insert({ id: '1', text: 't1', completed: false }),
        tables.todos.insert({ id: '2', text: 't2', completed: false }),
      )

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 1),
        Stream.runDrain,
      )

      const result = leaderThreadCtx.dbReadModel.select(tables.todos.query.asSql().query)

      expect(result).toEqual([
        { id: '1', text: 't1', completed: 0 },
        { id: '2', text: 't2', completed: 0 },
      ])

      yield* testContext.mockSyncBackend.pushedMutationEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withCtx(test)),
  )

  // TODO property based testing to test following cases:
  // push first, then pull + latency in between (need to adjust the backend id accordingly)
  // pull first, then push + latency in between
  // In this test we're simulating a client leader that is behind the backend
  Vitest.scopedLive('invalid push', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* testContext.mockSyncBackend.disconnect

      yield* testContext.mockSyncBackend.advance(
        testContext
          .encodeMutationEvent({
            ...tables.todos.insert({ id: '1', text: 't1', completed: false }),
            id: EventId.make({ global: 0, client: 0 }),
            parentId: EventId.ROOT,
          })
          .toGlobal(),
      )

      yield* testContext.localPush(tables.todos.insert({ id: '2', text: 't2', completed: false }))

      yield* Effect.sleep(20).pipe(Effect.withSpan('@livestore/common-tests:sync:sleep'))

      const result = leaderThreadCtx.dbReadModel.select(tables.todos.query.asSql().query)
      expect(result).toEqual([{ id: '2', text: 't2', completed: 0 }])

      // This will cause a rebase given mismatch: local insert(id: '2') vs remote insert(id: '1')
      yield* testContext.mockSyncBackend.connect

      yield* testContext.mockSyncBackend.pushedMutationEvents.pipe(Stream.take(1), Stream.runDrain)

      const rebasedResult = leaderThreadCtx.dbReadModel.select(tables.todos.query.asSql().query)
      expect(rebasedResult).toEqual([
        { id: '1', text: 't1', completed: 0 },
        { id: '2', text: 't2', completed: 0 },
      ])

      const queueResults = yield* Queue.takeAll(testContext.pullQueue).pipe(Effect.map(Chunk.toReadonlyArray))
      expect(queueResults[0]!.payload._tag).toEqual('upstream-advance')
      expect(queueResults[1]!.payload._tag).toEqual('upstream-rebase')
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('many local pushes', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const numberOfPushes = 100

      yield* Effect.forEach(
        Array.from({ length: numberOfPushes }, (_, i) => i),
        (i) =>
          testContext.localPush(
            tables.todos.insert({ id: `local-push-${i}`, text: `local-push-${i}`, completed: false }),
          ),
        { concurrency: 'unbounded' },
      ).pipe(Effect.withSpan(`@livestore/common-tests:sync:mutations(${numberOfPushes})`))

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === numberOfPushes - 1),
        Stream.runDrain,
      )

      const result = leaderThreadCtx.dbReadModel.select(tables.todos.query.asSql().query)
      expect(result.length).toEqual(numberOfPushes)

      const queueResults = yield* Queue.takeAll(testContext.pullQueue).pipe(Effect.map(Chunk.toReadonlyArray))
      expect(queueResults.every((result) => result.payload._tag === 'upstream-advance')).toBe(true)
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('concurrent pushes', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      for (let i = 0; i < 5; i++) {
        yield* testContext.mockSyncBackend
          .advance(
            testContext
              .encodeMutationEvent({
                ...tables.todos.insert({ id: `backend_${i}`, text: '', completed: false }),
                id: EventId.make({ global: i, client: 0 }),
                parentId: EventId.make({ global: i - 1, client: 0 }),
              })
              .toGlobal(),
          )
          .pipe(Effect.fork)
      }

      for (let i = 0; i < 5; i++) {
        yield* testContext
          .localPush(tables.todos.insert({ id: `local_${i}`, text: '', completed: false }))
          .pipe(Effect.tapCauseLogPretty, Effect.exit)
      }

      yield* testContext.mockSyncBackend.pushedMutationEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withCtx(test)),
  )

  // TODO tests for
  // - aborting local pushes
  // - processHead works properly
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    mockSyncBackend: MockSyncBackend
    encodeMutationEvent: (
      event: Omit<MutationEvent.AnyDecoded, 'clientId' | 'sessionId'>,
    ) => MutationEvent.EncodedWithMeta
    pullQueue: Queue.Queue<PullQueueItem>
    localPush: (
      ...partialEvents: MutationEvent.PartialAnyDecoded[]
    ) => Effect.Effect<void, UnexpectedError | LeaderAheadError, Scope.Scope | LeaderThreadCtx>
  }
>() {}

const LeaderThreadCtxLive = Effect.gen(function* () {
  const mockSyncBackend = yield* makeMockSyncBackend

  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
    Effect.withSpan('@livestore/adapter-node:leader-thread:loadSqlite3Wasm'),
  )

  const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeSqliteDb

  const leaderContextLayer = makeLeaderThreadLayer({
    schema,
    storeId: 'test',
    clientId: 'test',
    syncPayload: undefined,
    makeSqliteDb,
    syncOptions: { makeBackend: () => mockSyncBackend.makeSyncBackend },
    dbReadModel: yield* makeSqliteDb({ _tag: 'in-memory' }),
    dbMutationLog: yield* makeSqliteDb({ _tag: 'in-memory' }),
    devtoolsOptions: { enabled: false },
    shutdownChannel: yield* WebChannel.noopChannel<any, any>(),
  })

  const testContextLayer = Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx

    const encodeMutationEvent = ({
      meta,
      ...event
    }: Omit<typeof MutationEvent.EncodedWithMeta.Encoded, 'clientId' | 'sessionId'>) =>
      new MutationEvent.EncodedWithMeta({
        ...Schema.encodeUnknownSync(leaderThreadCtx.mutationEventSchema)({
          ...event,
          clientId: leaderThreadCtx.clientId,
          sessionId: undefined,
        }),
        meta,
      })

    const currentMutationEventId = { current: EventId.ROOT }

    const pullQueue = yield* leaderThreadCtx.connectedClientSessionPullQueues.makeQueue(EventId.ROOT)

    const toEncodedMutationEvent = (partialEvent: MutationEvent.PartialAnyDecoded) => {
      const nextIdPair = EventId.nextPair(currentMutationEventId.current, false)
      currentMutationEventId.current = nextIdPair.id
      return encodeMutationEvent({ ...partialEvent, ...nextIdPair })
    }

    const localPush = (...partialEvents: MutationEvent.PartialAnyDecoded[]) =>
      leaderThreadCtx.syncProcessor.push(partialEvents.map((partialEvent) => toEncodedMutationEvent(partialEvent)))

    return Layer.succeed(TestContext, {
      mockSyncBackend,
      encodeMutationEvent,
      pullQueue,
      localPush,
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(leaderContextLayer))

  return leaderContextLayer.pipe(Layer.merge(testContextLayer))
}).pipe(Layer.unwrapScoped)

const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'sync-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(IS_CI ? 60_000 : 10_000),
      Effect.provide(LeaderThreadCtxLive),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
