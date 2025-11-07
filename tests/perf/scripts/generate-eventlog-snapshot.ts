#!/usr/bin/env tsx

/**
 * Snapshot generator for perf benchmarks.
 *
 * Usage:
 *   direnv exec . pnpm --filter @local/tests-perf run generate-db-snapshot
 *   STREAM_EVENTS_TOTAL=250000 direnv exec . pnpm --filter @local/tests-perf run generate-db-snapshot
 *
 * The script synthesizes `TOTAL_EVENTS` todos using the real materializer, then
 * writes `eventlog-<count>.sqlite`, `state-<count>.sqlite`, and
 * `snapshot-<count>.json` into `tests/perf/snapshots/` for reuse by
 * `stream-events-benchmark.ts` (run via `pnpm --filter @local/tests-perf run test-event-streaming`).
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BootStatus } from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Option, Queue } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { events as fixtureEvents, schema as fixtureSchema } from './fixture.ts'

const outputDir = new URL('../snapshots/', import.meta.url)
const workspaceDir = new URL('./workspace/', import.meta.url)

const totalEvents = Number.parseInt(process.env.TOTAL_EVENTS ?? '100000', 10)

type Operation = 'create' | 'complete' | 'delete'
const operationCycle: readonly Operation[] = ['create', 'create', 'complete', 'create', 'delete']

const clientSessions = [
  { clientId: 'client-alpha', sessionId: 'session-1' },
  { clientId: 'client-beta', sessionId: 'session-2' },
  { clientId: 'client-gamma', sessionId: 'session-3' },
]

const toEncodedWithMeta = (event: LiveStoreEvent.AnyEncodedGlobal): LiveStoreEvent.EncodedWithMeta =>
  LiveStoreEvent.EncodedWithMeta.fromGlobal(event, {
    syncMetadata: Option.none(),
    materializerHashLeader: Option.none(),
    materializerHashSession: Option.none(),
  })

const makeDatabases = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

  const workspacePath = fileURLToPath(workspaceDir)
  yield* Effect.promise(() => mkdir(workspacePath, { recursive: true }))
  const workingDir = yield* Effect.promise(() => mkdtemp(path.join(workspacePath, 'snapshot-')))

  const dbEventlog = yield* makeSqliteDb({ _tag: 'fs', directory: workingDir, fileName: 'eventlog.sqlite' })
  const dbState = yield* makeSqliteDb({ _tag: 'fs', directory: workingDir, fileName: 'state.sqlite' })

  yield* Eventlog.initEventlogDb(dbEventlog)

  const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
  const materializeEvent = yield* makeMaterializeEvent({ schema: fixtureSchema, dbState, dbEventlog })
  yield* recreateDb({ dbState, dbEventlog, schema: fixtureSchema, bootStatusQueue, materializeEvent })
  yield* Queue.shutdown(bootStatusQueue)

  return { dbEventlog, dbState, workingDir, materializeEvent }
})

const run = Effect.scoped(
  Effect.gen(function* () {
    const { dbEventlog, dbState, workingDir, materializeEvent } = yield* makeDatabases

    const eventlogWorkingPath = path.join(workingDir, 'eventlog.sqlite')
    const stateWorkingPath = path.join(workingDir, 'state.sqlite')

    const baseFactory = EventFactory.makeFactory(fixtureEvents)
    const factories = clientSessions.map(({ clientId, sessionId }) =>
      baseFactory({ client: EventFactory.clientIdentity(clientId, sessionId) }),
    )

    const activeTodoIds: string[] = []
    let nextTodoId = 1
    let rotationIndex = 0
    let lastEvent: LiveStoreEvent.EncodedWithMeta | undefined

    const pickActiveId = () => {
      const id = activeTodoIds[rotationIndex % activeTodoIds.length]!
      rotationIndex = (rotationIndex + 1) % activeTodoIds.length
      return id
    }

    const applyEvent = (event: LiveStoreEvent.EncodedWithMeta) =>
      Effect.gen(function* () {
        yield* materializeEvent(event)
        lastEvent = event
      })

    for (let index = 0; index < totalEvents; index++) {
      const factory = factories[index % factories.length]!
      let operation = operationCycle[index % operationCycle.length]!

      if (operation !== 'create' && activeTodoIds.length === 0) {
        operation = 'create'
      } else if (operation === 'delete' && activeTodoIds.length <= 1) {
        operation = 'complete'
      }

      const nextSeq = index + 1
      const parentSeq = lastEvent ? Number(lastEvent.seqNum.global) : ('root' as const)

      const encodeWith = <TArgs>(
        eventFactory: {
          advanceTo: (seq: number, parent?: number | 'root') => void
          next: (args: TArgs) => LiveStoreEvent.AnyEncodedGlobal
        },
        args: TArgs,
      ) => {
        eventFactory.advanceTo(nextSeq, parentSeq)
        const encodedGlobal = eventFactory.next(args)
        return toEncodedWithMeta(encodedGlobal)
      }

      let encoded: LiveStoreEvent.EncodedWithMeta

      if (operation === 'create') {
        const id = `${nextTodoId++}`
        activeTodoIds.push(id)
        encoded = encodeWith(factory.todoCreated, {
          id,
          text: `todo-${id}`,
          completed: index % 7 === 0,
        })
      } else if (operation === 'complete') {
        const id = pickActiveId()
        encoded = encodeWith(factory.todoCompleted, { id })
      } else {
        const id = pickActiveId()
        const removalIndex = activeTodoIds.indexOf(id)
        if (removalIndex >= 0) {
          activeTodoIds.splice(removalIndex, 1)
          if (rotationIndex > removalIndex) {
            rotationIndex -= 1
          }
        }
        encoded = encodeWith(factory.todoDeletedNonPure, { id })
      }

      yield* applyEvent(encoded)
    }

    if (lastEvent) {
      const head = lastEvent
      yield* Effect.sync(() => Eventlog.updateBackendHead(dbEventlog, head.seqNum))
    }

    dbEventlog.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    dbEventlog.execute('PRAGMA journal_mode=DELETE')
    dbState.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    dbState.execute('PRAGMA journal_mode=DELETE')

    dbEventlog.close()
    dbState.close()

    return {
      workingDir,
      eventlogWorkingPath,
      stateWorkingPath,
      finalSeqNum: lastEvent?.seqNum ?? EventSequenceNumber.ROOT,
    }
  }),
)

await mkdir(fileURLToPath(outputDir), { recursive: true })
await mkdir(fileURLToPath(workspaceDir), { recursive: true })

const { workingDir, eventlogWorkingPath, stateWorkingPath, finalSeqNum } = await Effect.runPromise(
  run.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)),
)

const eventlogFile = fileURLToPath(new URL(`eventlog-${totalEvents}.sqlite`, outputDir))
const stateFile = fileURLToPath(new URL(`state-${totalEvents}.sqlite`, outputDir))
const metadataFile = fileURLToPath(new URL(`snapshot-${totalEvents}.json`, outputDir))

await copyFile(eventlogWorkingPath, eventlogFile)
await copyFile(stateWorkingPath, stateFile)

const metadata = {
  totalEvents,
  firstEventGlobal: totalEvents > 0 ? 1 : 0,
  finalSeqNum: {
    global: Number(finalSeqNum.global),
    client: Number(finalSeqNum.client),
    rebaseGeneration: finalSeqNum.rebaseGeneration,
  },
  clients: clientSessions,
}

await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

await rm(workingDir, { recursive: true, force: true })

console.log('Snapshot generated:')
console.log(`  Eventlog: ${eventlogFile}`)
console.log(`  State   : ${stateFile}`)
console.log(`  Meta    : ${metadataFile}`)
