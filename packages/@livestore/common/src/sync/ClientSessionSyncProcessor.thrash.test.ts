import {
  Duration,
  Effect,
  Fiber,
  Logger,
  LogLevel,
  Option,
  Queue,
  type Runtime,
  Schema,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import type { ClientSession } from '../adapter-types.ts'
import type { ClientSessionLeaderThreadProxy } from '../ClientSessionLeaderThreadProxy.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import { Events, LiveStoreEvent, makeSchema, State } from '../schema/mod.ts'
import { makeClientSessionSyncProcessor } from './ClientSessionSyncProcessor.ts'
import * as SyncState from './syncstate.ts'

// Minimal schema with a single synced event and a simple table
const todo = State.SQLite.table({
  name: 'todo',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text(),
  },
})

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const state = State.SQLite.makeState({
  tables: { todo },
  materializers: State.SQLite.materializers(events, { todoCreated: () => '' }),
})
const schema = makeSchema({ state, events })

// Helper to build a single upstream global event at e1 -> e0
const upstreamEvent = new LiveStoreEvent.EncodedWithMeta({
  name: 'todoCreated',
  args: { id: 'u1', title: 'upstream' },
  seqNum: EventSequenceNumber.make({ global: 1 as any, client: 0 as any, rebaseGeneration: 0 }),
  parentSeqNum: EventSequenceNumber.ROOT,
  clientId: 'leader',
  sessionId: 'static',
})

// A pull stream that emits an upstream-rebase payload every `intervalMs`, repeated `count` times
const makeRebaseStream = (intervalMs: number, count: number) =>
  Stream.asyncPush<{ payload: typeof SyncState.PayloadUpstream.Type }>((emit) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        let i = 0
        const timer = setInterval(() => {
          if (i >= count) return
          i++
          void emit.single({
            payload: SyncState.PayloadUpstreamRebase.make({ rollbackEvents: [], newEvents: [upstreamEvent] }),
          })
        }, intervalMs)
        return timer
      }),
      (timer) => Effect.sync(() => clearInterval(timer as any)),
    ),
  )

const makeClientSessionStub = ({
  rebaseEveryMs,
  rebaseCount,
  pushDurationMs,
}: {
  rebaseEveryMs: number
  rebaseCount: number
  pushDurationMs: number
}): Effect.Effect<ClientSession> =>
  Effect.gen(function* () {
    const leaderHead = EventSequenceNumber.ROOT
    const confirmQueue = yield* Queue.unbounded<ReadonlyArray<typeof LiveStoreEvent.EncodedWithMeta.Type>>()

    // Pull emits frequent upstream-rebase payloads
    const pull = (_: { cursor: EventSequenceNumber.EventSequenceNumber }) =>
      Stream.merge(
        makeRebaseStream(rebaseEveryMs, rebaseCount),
        Stream.fromQueue(confirmQueue, { maxChunkSize: 1 }).pipe(
          Stream.map((batch) => ({
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: batch as any }),
          })),
        ),
      )

    // Push simulates slow network push to leader
    const push = (batch: ReadonlyArray<LiveStoreEvent.AnyEncoded>) =>
      Effect.gen(function* () {
        // Simulate network/processing latency
        yield* Effect.sleep(Duration.millis(pushDurationMs))
        // Confirm the pushed batch via upstream-advance
        yield* Queue.offer(confirmQueue, batch as any)
      })

    const leaderThread: ClientSessionLeaderThreadProxy = {
      initialState: { leaderHead, migrationsReport: { migrations: [] } },
      events: { pull, push },
      export: Effect.dieMessage('unused'),
      getEventlogData: Effect.dieMessage('unused'),
      getSyncState: Effect.dieMessage('unused'),
      sendDevtoolsMessage: () => Effect.void,
    }
    const lockStatus = yield* SubscriptionRef.make<'has-lock' | 'no-lock'>('has-lock')
    return {
      sqliteDb: {} as any,
      devtools: { enabled: false },
      clientId: 'client-a',
      sessionId: 'static',
      lockStatus,
      shutdown: () => Effect.void,
      leaderThread,
      debugInstanceId: 'test',
    } satisfies ClientSession
  })

describe('ClientSessionSyncProcessor thrash (targeted)', () => {
  it('repeated upstream-rebase cancels pusher and prevents draining pending (single CPU-like)', async () => {
    // 1) Build processor with small push batch size
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clientSession = yield* makeClientSessionStub({
            rebaseEveryMs: 60,
            rebaseCount: 50,
            pushDurationMs: 100,
          })
          const runtime = {} as any as Runtime.Runtime<any>

          const processor = makeClientSessionSyncProcessor({
            schema,
            clientSession,
            runtime,
            materializeEvent: (_decoded) =>
              Effect.succeed({
                writeTables: new Set<string>(),
                sessionChangeset: { _tag: 'no-op' as const },
                materializerHash: Option.none<number>(),
              }),
            rollback: () => {},
            refreshTables: () => {},
            // No-op otel span
            span: { addEvent: () => {} } as any,
            params: { leaderPushBatchSize: 2 },
            confirmUnsavedChanges: false,
          })

          // 2) Boot pulls in background
          yield* processor.boot.pipe(Logger.withMinimumLogLevel(LogLevel.Error))

          // 3) Push a large local batch to create pending
          const batch = Array.from({ length: 100 }, (_, i) => ({
            name: 'todoCreated' as const,
            args: { id: `l${i}`, title: 'local' },
          }))
          yield* processor.push(batch)

          // 4) Observe sync state for a short period; pending should not drain due to thrash
          let minPending = Number.POSITIVE_INFINITY
          const fiber = yield* processor.syncState.changes.pipe(
            Stream.map((s) => s.pending.length),
            Stream.tap((n) =>
              Effect.sync(() => {
                minPending = Math.min(minPending, n)
              }),
            ),
            Stream.runDrain,
            Effect.fork,
          )
          yield* Effect.sleep('800 millis')
          yield* Fiber.interrupt(fiber)
          expect(minPending).toBeGreaterThanOrEqual(50)
        }),
      ),
    )
  })

  // Failing repro: asserts that pending should drain under rebase pressure within ~1s.
  // Current behavior thrashes the pusher, so this fails. Enable explicitly to see it red.
  const _itFail = process.env.NODE_SYNC_FAIL_REPRO === '1' ? it : it //.skip
  it('should drain pending within 1s under rebase pressure (expected to fail before fix)', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clientSession = yield* makeClientSessionStub({
            rebaseEveryMs: 20,
            rebaseCount: 50,
            pushDurationMs: 100,
          })
          const runtime = {} as any as Runtime.Runtime<any>

          const processor = makeClientSessionSyncProcessor({
            schema,
            clientSession,
            runtime,
            materializeEvent: (_decoded) =>
              Effect.succeed({
                writeTables: new Set<string>(),
                sessionChangeset: { _tag: 'no-op' as const },
                materializerHash: Option.none<number>(),
              }),
            rollback: () => {},
            refreshTables: () => {},
            span: { addEvent: () => {} } as any,
            params: { leaderPushBatchSize: 2 },
            confirmUnsavedChanges: false,
          })

          yield* processor.boot

          const batch = Array.from({ length: 100 }, (_, i) => ({
            name: 'todoCreated' as const,
            args: { id: `l${i}`, title: 'local' },
          }))
          yield* processor.push(batch)

          const initialPending = (yield* processor.syncState).pending.length
          yield* Effect.sleep('1000 millis')
          const afterPending = (yield* processor.syncState).pending.length

          // Expect at least half of pending drained within 1s.
          expect(afterPending).toBeLessThanOrEqual(Math.floor(initialPending / 2))
        }),
      ),
    )
  })
})
