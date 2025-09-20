import { EventSequenceNumber, LiveStoreEvent, nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import {
  Effect,
  FetchHttpClient,
  type HttpClient,
  KeyValueStore,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
  Option,
  Stream,
} from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import * as S2Provider from './providers/s2.ts'
import { SyncProviderImpl } from './types.ts'

// Focused S2 scenarios

const withTestCtx = ({ suffix }: { suffix?: string } = {}) => Vitest.makeWithTestCtx({ suffix })

Vitest.describe('S2-specific', { timeout: 60000 }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore,
    never
  >
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      S2Provider.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(KeyValueStore.layerMemory),
        Layer.provide(Logger.prettyWithThread('s2-specific')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = (testName?: string) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider({
          storeId: `s2-specific-${testName}-${testId}`,
          clientId: 'test-client',
          payload: undefined,
        }),
      ).pipe(Effect.provide(runtime)),
    )

  Vitest.scopedLive('SSE reconnect resumes and receives new events', (test) =>
    Effect.gen(function* () {
      // Create a backend with payload to trigger one-time SSE close in proxy
      const storeId = `s2-reconnect-${test.task.name}-${testId}`
      const provider = yield* SyncProviderImpl
      const syncBackend = yield* provider.makeProvider({
        storeId,
        clientId: 'test-client',
        payload: { testCloseOnce: true },
      })

      // Start a live pull and wait for first non-empty batch
      const fiber = yield* syncBackend.pull(Option.none(), { live: true }).pipe(
        Stream.filter((i) => i.batch.length > 0),
        Stream.runFirstUnsafe,
        Effect.fork,
      )

      // Give SSE a moment to connect and be closed by proxy, then push an event
      yield* Effect.sleep(300)

      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: 'rc1', text: 'Reconnect OK', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      const result = yield* fiber
      expect(result.batch.length).toBe(1)
    }).pipe(Effect.provide(runtime), withTestCtx()(test)),
  )

  Vitest.scopedLive('retries transient append failure', (test) =>
    Effect.gen(function* () {
      const storeId = `s2-retry-append-${test.task.name}-${testId}`
      const provider = yield* SyncProviderImpl
      const syncBackend = yield* provider.makeProvider({ storeId, clientId: 'test-client', payload: undefined })

      // Induce one append failure on server; client should retry and succeed
      yield* provider.providerSpecific.failNextAppend(storeId, 1)

      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: 'ap1', text: 'append retry ok', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      const result = yield* syncBackend.pull(Option.none()).pipe(
        Stream.filter((i) => i.batch.length > 0),
        Stream.runFirstUnsafe,
      )
      expect(result.batch.length).toBe(1)
    }).pipe(Effect.provide(runtime), withTestCtx()(test)),
  )

  Vitest.scopedLive('retries transient non-live read failure', (test) =>
    Effect.gen(function* () {
      const storeId = `s2-retry-read-${test.task.name}-${testId}`
      const provider = yield* SyncProviderImpl
      const syncBackend = yield* provider.makeProvider({ storeId, clientId: 'test-client', payload: undefined })

      // Push an event to be read
      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: 'rd1', text: 'read retry ok', completed: true }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      // Induce one read failure; client should retry and still receive the event
      yield* provider.providerSpecific.failNextRead(storeId, 1)

      const result = yield* syncBackend.pull(Option.none()).pipe(
        Stream.filter((i) => i.batch.length > 0),
        Stream.runFirstUnsafe,
      )
      expect(result.batch.length).toBe(1)
    }).pipe(Effect.provide(runtime), withTestCtx()(test)),
  )

  Vitest.scopedLive('non-live decoding (JSON ReadBatch) returns events', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      // Append raw records via providerSpecific (two valid LiveStore events)
      const provider = yield* SyncProviderImpl
      const storeId = `s2-specific-${test.task.name}-${testId}`
      const providerSpecific = provider.providerSpecific as S2Provider.ProviderSpecific

      const ev1 = LiveStoreEvent.AnyEncodedGlobal.make({
        ...events.todoCreated({ id: 'raw1', text: 'raw ok 1', completed: false }),
        clientId: 'test-client',
        sessionId: 'test-session',
        seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
        parentSeqNum: EventSequenceNumber.ROOT.global,
      })
      const ev2 = LiveStoreEvent.AnyEncodedGlobal.make({
        ...events.todoCreated({ id: 'raw2', text: 'raw ok 2', completed: true }),
        clientId: 'test-client',
        sessionId: 'test-session',
        seqNum: EventSequenceNumber.globalEventSequenceNumber(2),
        parentSeqNum: EventSequenceNumber.globalEventSequenceNumber(1),
      })

      yield* providerSpecific.appendRaw(storeId, [JSON.stringify(ev1), JSON.stringify(ev2)])

      // Non-live pull should yield the 2 events
      const results = yield* syncBackend.pull(Option.none()).pipe(Stream.runCollectReadonlyArray)
      const eventsPulled = results.flatMap((r) => r.batch.map((b) => b.eventEncoded))
      expect(eventsPulled.length).toBeGreaterThanOrEqual(2)
      // Expect first two events to be our valid ones (ordering preserved)
      expect(eventsPulled[0]!.name).toBe(ev1.name)
      expect(eventsPulled[1]!.name).toBe(ev2.name)
    }).pipe(Effect.provide(runtime), withTestCtx()(test)),
  )
})
