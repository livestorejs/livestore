import { Statement } from '@effect/sql'
import * as SqlClient from '@effect/sql/SqlClient'
import type * as SqlError from '@effect/sql/SqlError'
import * as SqlSchema from '@effect/sql/SqlSchema'
import { ServerAheadError, UnknownError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Context, Effect, identity, Layer, ReadonlyArray } from '@livestore/utils/effect'

const sqlNoop = Statement.make(Effect.never, {} as any, [], identity)

/**
 * A service representing the current store ID.
 */
export class CurrentStoreId extends Context.Tag('@livestore/sync-http/server/CurrentStoreId')<
  CurrentStoreId,
  string
>() {}

/**
 * A service representing the table name for a specific store.
 */
export class StoreTableName extends Context.Tag('@livestore/sync-http/server/StoreTableName')<
  StoreTableName,
  {
    readonly name: string
    readonly sql: Statement.Identifier
  }
>() {
  static readonly fromHash = (hash: string) => {
    const name = `ls_events_${hash}`
    return Layer.succeed(StoreTableName, {
      name,
      sql: sqlNoop(name),
    })
  }
}

export class EventStorage extends Context.Tag('@livestore/sync-http/server/EventStorage')<
  EventStorage,
  {
    readonly push: (
      batch: ReadonlyArray.NonEmptyReadonlyArray<LiveStoreEvent.Global.Encoded>,
    ) => Effect.Effect<void, ServerAheadError | UnknownError>
    readonly pull: (
      since: EventSequenceNumber.Global.Type,
    ) => Effect.Effect<ReadonlyArray<LiveStoreEvent.Global.Encoded>, UnknownError>
    readonly backendId: Effect.Effect<string>
  }
>() {}

export const EventsStorageMemory = Layer.effect(
  EventStorage,
  Effect.gen(function* () {
    const events = ReadonlyArray.empty<LiveStoreEvent.Global.Encoded | undefined>()
    let latestSeqNum = 0
    const backendId = crypto.randomUUID()

    return EventStorage.of({
      backendId: Effect.succeed(backendId),
      push: (batch) =>
        Effect.suspend(() => {
          if (!ReadonlyArray.isNonEmptyReadonlyArray(batch)) {
            return Effect.void
          }
          if (batch[0].seqNum <= latestSeqNum) {
            return Effect.fail(
              new ServerAheadError({
                minimumExpectedNum: EventSequenceNumber.Global.make(latestSeqNum + 1),
                providedNum: batch[0].seqNum,
              }),
            )
          }
          for (const event of batch) {
            events[event.seqNum] = event
          }
          latestSeqNum = ReadonlyArray.lastNonEmpty(batch).seqNum
          return Effect.void
        }),
      pull: (since) =>
        Effect.sync(() => {
          const result: LiveStoreEvent.Global.Encoded[] = []
          for (let seqNum = since + 1; seqNum <= latestSeqNum; seqNum++) {
            const event = events[seqNum]
            if (event) {
              result.push(event)
            }
          }
          return result
        }),
    })
  }),
)

export const EventStorageSql = Layer.scoped(
  EventStorage,
  Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms()
    const table = yield* StoreTableName
    const storeId = yield* CurrentStoreId
    const contextTable = sql('ls_store_contexts')

    const forUpdate = sql.onDialectOrElse({
      pg: () => sql` FOR UPDATE`,
      mysql: () => sql` FOR UPDATE`,
      // sqlite
      orElse: () => sql``,
    })

    yield* sql.onDialectOrElse({
      pg: () => sql`
        CREATE TABLE IF NOT EXISTS ${contextTable} (
          id SERIAL PRIMARY KEY,
          storeId VARCHAR(256) NOT NULL UNIQUE,
          backendId VARCHAR(36) NOT NULL
        )
      `,
      mysql: () => sql`
        CREATE TABLE IF NOT EXISTS ${contextTable} (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          storeId VARCHAR(256) NOT NULL UNIQUE,
          backendId VARCHAR(36) NOT NULL
        )
      `,
      // sqlite
      orElse: () => sql`
        CREATE TABLE IF NOT EXISTS ${contextTable} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          storeId TEXT NOT NULL UNIQUE,
          backendId TEXT NOT NULL
        )
      `,
    })

    const backendId = yield* sql.withTransaction(
      Effect.gen(function* () {
        let backendId = yield* sql<{
          backendId: string
        }>`select backendId from ${contextTable} where storeId = ${storeId}${forUpdate}`.pipe(
          Effect.map((rows) => rows[0]?.backendId),
        )
        if (!backendId) {
          backendId = crypto.randomUUID()
          yield* sql`insert into ${contextTable} (storeId, backendId) values (${storeId}, ${backendId})`
        }
        return backendId
      }),
    )

    yield* sql.onDialectOrElse({
      pg: () => sql`
        CREATE TABLE IF NOT EXISTS ${table.sql} (
          seqNum BIGINT PRIMARY KEY,
          parentSeqNum BIGINT NOT NULL,
          name TEXT NOT NULL,
          args TEXT,
          clientId VARCHAR(36) NOT NULL,
          sessionId VARCHAR(36) NOT NULL
        )
        `,
      mysql: () => sql`
        CREATE TABLE IF NOT EXISTS ${table.sql} (
          seqNum BIGINT PRIMARY KEY,
          parentSeqNum BIGINT NOT NULL,
          name TEXT NOT NULL,
          args TEXT,
          clientId VARCHAR(36) NOT NULL,
          sessionId VARCHAR(36) NOT NULL
        )
        `,
      // sqlite
      orElse: () => sql`
        CREATE TABLE IF NOT EXISTS ${table.sql} (
          seqNum INTEGER PRIMARY KEY,
          parentSeqNum INTEGER NOT NULL,
          name TEXT NOT NULL,
          args TEXT,
          clientId TEXT NOT NULL,
          sessionId TEXT NOT NULL
        )
        `,
    })

    const latestSeqNum = sql<{ max: number }>`select max(seqNum) as max from ${table.sql}${forUpdate}`.pipe(
      Effect.map((rows) => rows[0]?.max ?? 0),
    )

    const push = Effect.fnUntraced(
      function* (
        batch: ReadonlyArray.NonEmptyReadonlyArray<LiveStoreEvent.Global.Encoded>,
      ): Effect.fn.Return<void, ServerAheadError | SqlError.SqlError> {
        const latestSeq = yield* latestSeqNum
        if (batch[0].parentSeqNum !== latestSeq) {
          return yield* Effect.fail(
            new ServerAheadError({
              minimumExpectedNum: EventSequenceNumber.Global.make(latestSeq + 1),
              providedNum: batch[0].seqNum,
            }),
          )
        }
        for (const chunk of ReadonlyArray.chunksOf(batch, 50)) {
          yield* sql`insert into ${table.sql} ${sql.insert(
            chunk.map((event) => ({
              ...event,
              args: JSON.stringify(event.args),
            })),
          )}`.unprepared
        }
      },
      sql.withTransaction,
      Effect.catchTag(
        'SqlError',
        (_) =>
          new UnknownError({
            cause: new Error('Failed to execute sql query'),
          }),
      ),
    )

    const eventsSince = SqlSchema.findAll({
      Request: EventSequenceNumber.Global.Schema,
      Result: LiveStoreEvent.Global.Encoded,
      execute: (since) =>
        sql<{
          seqNum: number
          parentSeqNum: number
          name: string
          args: string | null
          clientId: string
          sessionId: string
        }>`select seqNum, parentSeqNum, name, args, clientId, sessionId from ${table.sql} where seqNum > ${since} order by seqNum asc`.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              ...row,
              args: row.args ? JSON.parse(row.args) : undefined,
            })),
          ),
        ),
    })
    const pull = (since: EventSequenceNumber.Global.Type) =>
      eventsSince(since).pipe(
        Effect.mapError(
          (_) =>
            new UnknownError({
              cause: new Error('Failed to execute sql query'),
            }),
        ),
      )

    return EventStorage.of({
      backendId: Effect.succeed(backendId),
      push,
      pull,
    })
  }).pipe(Effect.orDie),
)
