#!/usr/bin/env tsx

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { SyncState } from '@livestore/common'
import { Eventlog, streamEventsWithSyncState } from '@livestore/common/leader-thread'
import { EventSequenceNumber, type LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Fiber, Queue, Ref, Stream, Subscribable } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

type SnapshotMetadata = {
  totalEvents: number
  firstEventGlobal: number
  finalSeqNum: {
    global: number
    client: number
    rebaseGeneration: number
  }
  clients: ReadonlyArray<{ clientId: string; sessionId: string }>
}

const snapshotDir = new URL('../snapshots/', import.meta.url)
const snapshotEventCount = Number.parseInt(process.env.STREAM_EVENTS_TOTAL ?? '100000', 10)

const eventlogSnapshotPath = fileURLToPath(new URL(`eventlog-${snapshotEventCount}.sqlite`, snapshotDir))
const stateSnapshotPath = fileURLToPath(new URL(`state-${snapshotEventCount}.sqlite`, snapshotDir))
const metadataSnapshotPath = fileURLToPath(new URL(`snapshot-${snapshotEventCount}.json`, snapshotDir))

if (![eventlogSnapshotPath, stateSnapshotPath, metadataSnapshotPath].every((path) => existsSync(path))) {
  console.error('Snapshot assets are missing. Please run the generator before executing this benchmark.')
  process.exit(1)
}

const benchmarkEffect = Effect.scoped(
  Effect.gen(function* () {
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

    const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
    const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })

    const [eventlogBytes, stateBytes, metadataRaw] = yield* Effect.all([
      Effect.promise(() => readFile(eventlogSnapshotPath)),
      Effect.promise(() => readFile(stateSnapshotPath)),
      Effect.promise(() => readFile(metadataSnapshotPath, 'utf8')),
    ] as const)

    const metadata: SnapshotMetadata = JSON.parse(metadataRaw)
    const finalSeqNum = EventSequenceNumber.make(metadata.finalSeqNum)

    dbEventlog.import(new Uint8Array(eventlogBytes))
    dbState.import(new Uint8Array(stateBytes))
    Eventlog.updateBackendHead(dbEventlog, finalSeqNum)

    const initialSyncState = SyncState.SyncState.make({
      pending: [],
      upstreamHead: EventSequenceNumber.ROOT,
      localHead: EventSequenceNumber.ROOT,
    })

    const syncStateRef = yield* Ref.make(initialSyncState)
    const headQueue = yield* Queue.unbounded<SyncState.SyncState>()

    const syncState = Subscribable.make({
      get: Ref.get(syncStateRef),
      changes: Stream.fromQueue(headQueue),
    })

    const advanceHead = (head: EventSequenceNumber.EventSequenceNumber) =>
      Effect.gen(function* () {
        const nextState = SyncState.SyncState.make({
          pending: [],
          upstreamHead: head,
          localHead: head,
        })
        yield* Ref.set(syncStateRef, nextState)
        yield* Queue.offer(headQueue, nextState)
      })

    const closeHeads = Queue.shutdown(headQueue)

    let totalEmitted = 0
    let firstEventLatencyMs: number | null = null
    let firstEventSeq: number | null = null

    const stream = streamEventsWithSyncState({
      dbEventlog,
      dbState,
      syncState,
      options: {
        since: EventSequenceNumber.ROOT,
      },
    })

    const start = performance.now()

    const formatMillis = (value: number) => Math.round(value * 100) / 100

    const collectFiber = yield* stream
      .pipe(
        Stream.tap((event: LiveStoreEvent.EncodedWithMeta) =>
          Effect.sync(() => {
            totalEmitted += 1
            if (firstEventLatencyMs === null) {
              firstEventLatencyMs = performance.now() - start
              firstEventSeq = Number(event.seqNum.global)
            }
          }),
        ),
        Stream.take(metadata.totalEvents),
        Stream.runDrain,
      )
      .pipe(Effect.forkScoped)

    yield* advanceHead(finalSeqNum)
    yield* Fiber.join(collectFiber)

    const durationMs = performance.now() - start
    const throughput = totalEmitted / (durationMs / 1000)

    const result = {
      dataset: {
        totalEvents: metadata.totalEvents,
        firstEventGlobal: metadata.firstEventGlobal,
        clients: metadata.clients,
      },
      metrics: {
        totalEmitted,
        durationMs: formatMillis(durationMs),
        throughputEventsPerSecond: Math.round(throughput * 100) / 100,
        firstEventLatencyMs: firstEventLatencyMs === null ? null : formatMillis(firstEventLatencyMs),
        firstEventSeq,
      },
    }

    console.log(JSON.stringify(result, null, 2))

    yield* closeHeads
  }),
)

try {
  await Effect.runPromise(benchmarkEffect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)))
} catch (error) {
  console.error('Failed to execute stream events benchmark.', error)
  process.exitCode = 1
}
