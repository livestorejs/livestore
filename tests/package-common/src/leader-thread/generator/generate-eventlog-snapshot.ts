#!/usr/bin/env tsx

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import type { BootStatus } from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Option, Queue, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { events as fixtureEvents, schema as fixtureSchema } from '../fixture.ts'

const outputDir = new URL('./out/', import.meta.url)

const totalEvents = Number.parseInt(process.env.TOTAL_EVENTS ?? '100000', 10)
const streamBatchSize = Number.parseInt(process.env.STREAM_BATCH_SIZE ?? '1000', 10)
const eventsPerTick = Number.parseInt(process.env.EVENTS_PER_TICK ?? '1000', 10)
const insertChunkSize = Number.parseInt(process.env.INSERT_CHUNK_SIZE ?? '1000', 10)
const targetDurationMs = Number.parseInt(process.env.TARGET_DURATION_MS ?? '5000', 10)

const eventHashes = {
  todoCreated: Schema.hash(fixtureEvents.todoCreated.schema),
  todoCompleted: Schema.hash(fixtureEvents.todoCompleted.schema),
  todoDeletedNonPure: Schema.hash(fixtureEvents.todoDeletedNonPure.schema),
} as const

const toEncodedWithMeta = (event: LiveStoreEvent.AnyEncodedGlobal): LiveStoreEvent.EncodedWithMeta =>
  LiveStoreEvent.EncodedWithMeta.fromGlobal(event, {
    syncMetadata: Option.none(),
    materializerHashLeader: Option.none(),
    materializerHashSession: Option.none(),
  })

const makeDatabases = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
  const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })

  yield* Eventlog.initEventlogDb(dbEventlog)

  const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
  const materializeEvent = yield* makeMaterializeEvent({ schema: fixtureSchema, dbState, dbEventlog })
  yield* recreateDb({ dbState, dbEventlog, schema: fixtureSchema, bootStatusQueue, materializeEvent })
  yield* Queue.shutdown(bootStatusQueue)

  return { dbEventlog, dbState }
})

const run = Effect.gen(function* () {
  const { dbEventlog, dbState } = yield* makeDatabases

  const eventFactory = EventFactory.makeFactory(fixtureEvents)({
    client: EventFactory.clientIdentity('client-perf', 'session-perf'),
  })

  let lastEvent: LiveStoreEvent.EncodedWithMeta | undefined

  for (let offset = 0; offset < totalEvents; offset += insertChunkSize) {
    const batchSize = Math.min(insertChunkSize, totalEvents - offset)
    for (let index = 0; index < batchSize; index++) {
      const eventIndex = offset + index
      const event = toEncodedWithMeta(
        eventFactory.todoCreated.next({
          id: `${eventIndex + 1}`,
          text: `todo-${eventIndex + 1}`,
          completed: false,
        }),
      )
      lastEvent = event
      yield* Eventlog.insertIntoEventlog(
        event,
        dbEventlog,
        eventHashes[event.name as keyof typeof eventHashes],
        event.clientId,
        event.sessionId,
      )
    }
  }

  const eventlogSnapshot = dbEventlog.export()
  const stateSnapshot = dbState.export()

  return {
    eventlogSnapshot,
    stateSnapshot,
    finalSeqNum: lastEvent?.seqNum ?? EventSequenceNumber.ROOT,
  }
})

await mkdir(fileURLToPath(outputDir), { recursive: true })

const result = await Effect.runPromise(run.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)))

const eventlogFile = fileURLToPath(new URL(`eventlog-${totalEvents}.sqlite`, outputDir))
const stateFile = fileURLToPath(new URL(`state-${totalEvents}.sqlite`, outputDir))
const metadataFile = fileURLToPath(new URL(`snapshot-${totalEvents}.json`, outputDir))

await writeFile(eventlogFile, Buffer.from(result.eventlogSnapshot))
await writeFile(stateFile, Buffer.from(result.stateSnapshot))

const metadata = {
  totalEvents,
  streamBatchSize,
  eventsPerTick,
  targetDurationMs,
  firstEventGlobal: totalEvents > 0 ? 1 : 0,
  finalSeqNum: {
    global: Number(result.finalSeqNum.global),
    client: Number(result.finalSeqNum.client),
    rebaseGeneration: result.finalSeqNum.rebaseGeneration,
  },
}

await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

console.log('Snapshot generated:')
console.log(`  Eventlog: ${eventlogFile}`)
console.log(`  State   : ${stateFile}`)
console.log(`  Meta    : ${metadataFile}`)
