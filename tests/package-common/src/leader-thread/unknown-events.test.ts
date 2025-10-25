import { sql } from '@livestore/common'
import { Eventlog, makeMaterializeEvent } from '@livestore/common/leader-thread'
import type { UnknownEvents } from '@livestore/common/schema'
import {
  EventSequenceNumber,
  Events,
  LiveStoreEvent,
  makeSchema,
  State,
  UNKNOWN_EVENT_SCHEMA_HASH,
} from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Option, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

// Verifies the behaviour of LiveStore's unknown-event handling strategies across
// materialization paths, ensuring events are either skipped, logged, or cause
// structured failures according to the selected strategy.

Vitest.describe.concurrent('unknown event handling in materializeEvent', () => {
  Vitest.scopedLive('warn strategy keeps event in log and continues', (test) =>
    Effect.gen(function* () {
      const { materializeEvent, dbEventlog } = yield* setup({ strategy: 'warn' })
      const event = makeUnknownEncodedEvent()

      const result = yield* materializeEvent(event, { skipEventlog: false })

      expect(result.sessionChangeset._tag).toEqual('no-op')
      expect(Option.isNone(result.hash)).toBe(true)

      const rows = dbEventlog.select<{ name: string; schemaHash: number }>(sql`SELECT name, schemaHash FROM eventlog`)
      expect(rows).toEqual([{ name: event.name, schemaHash: UNKNOWN_EVENT_SCHEMA_HASH }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('ignore strategy behaves like warn but silent', (test) =>
    Effect.gen(function* () {
      const { materializeEvent, dbEventlog } = yield* setup({ strategy: 'ignore' })
      const event = makeUnknownEncodedEvent()

      const result = yield* materializeEvent(event, {})

      expect(result.sessionChangeset._tag).toEqual('no-op')
      expect(Option.isNone(result.hash)).toBe(true)

      const rows = dbEventlog.select<{ name: string; schemaHash: number }>(sql`SELECT name, schemaHash FROM eventlog`)
      expect(rows).toEqual([{ name: event.name, schemaHash: UNKNOWN_EVENT_SCHEMA_HASH }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('fail strategy surfaces UnknownEventError', (test) =>
    Effect.gen(function* () {
      const { materializeEvent } = yield* setup({ strategy: 'fail' })
      const event = makeUnknownEncodedEvent()

      const result = yield* materializeEvent(event, {}).pipe(Effect.either)
      if (result._tag !== 'Left') {
        throw new Error('Expected materializeEvent to fail for fail strategy')
      }
      const error = result.left
      expect(error._tag).toEqual('LiveStore.MaterializeError')
      if (error.cause._tag !== 'LiveStore.UnknownEventError') {
        throw new Error(`Unexpected failure cause: ${error.cause._tag}`)
      }
      expect(error.cause.reason).toEqual('event-definition-missing')
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('callback strategy invokes observer once', (test) =>
    Effect.gen(function* () {
      const calls: Array<{ eventName: string; reason: string }> = []
      const { materializeEvent } = yield* setup({
        strategy: 'callback',
        onUnknownEvent: (context, error) => {
          calls.push({ eventName: context.event.name, reason: error.reason })
        },
      })
      const event = makeUnknownEncodedEvent()

      const result = yield* materializeEvent(event, {})

      expect(result.sessionChangeset._tag).toEqual('no-op')
      expect(calls).toEqual([{ eventName: event.name, reason: 'event-definition-missing' }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('warn strategy skips events missing materializers', (test) =>
    Effect.gen(function* () {
      const knownEvent = Events.synced({
        name: 'known-event',
        schema: Schema.Struct({ value: Schema.String }),
      })

      const schema = makeSchema({
        events: [knownEvent],
        state: State.SQLite.makeState({ tables: {}, materializers: {} }),
        unknownEventHandling: { strategy: 'warn' },
      })

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)

      const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog })

      const event = new LiveStoreEvent.EncodedWithMeta({
        name: 'known-event',
        args: { value: 'example' },
        seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.ROOT,
        clientId: 'client-2',
        sessionId: 'session-2',
      })

      const result = yield* materializeEvent(event, {})

      expect(result.sessionChangeset._tag).toEqual('no-op')
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})

const makeUnknownEncodedEvent = () =>
  new LiveStoreEvent.EncodedWithMeta({
    name: 'v1.UnknownEvent',
    args: { payload: 'test' },
    seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
    parentSeqNum: EventSequenceNumber.ROOT,
    clientId: 'client-1',
    sessionId: 'session-1',
  })

const makeSchemaWith = (config: UnknownEvents.HandlingConfig) =>
  makeSchema({
    events: [],
    state: State.SQLite.makeState({ tables: {}, materializers: {} }),
    unknownEventHandling: config,
  })

const setup = (config: UnknownEvents.HandlingConfig) =>
  Effect.gen(function* () {
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('tests:unknown-events:loadSqlite3Wasm'),
    )
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

    const schema = makeSchemaWith(config)
    yield* Eventlog.initEventlogDb(dbEventlog)

    const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog })

    return { materializeEvent, dbEventlog, schema }
  })
