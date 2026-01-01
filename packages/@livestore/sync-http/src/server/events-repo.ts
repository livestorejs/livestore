import { Statement } from '@effect/sql'
import * as SqlClient from '@effect/sql/SqlClient'
import type * as SqlError from '@effect/sql/SqlError'
import * as SqlSchema from '@effect/sql/SqlSchema'
import { ServerAheadError, UnknownError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Context, Effect, identity, Layer, type ReadonlyArray } from '@livestore/utils/effect'

const sqlNoop = Statement.make(Effect.never, {} as any, [], identity)

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
    return Layer.succeed(StoreTableName, {
      name: hash,
      sql: sqlNoop(hash),
    })
  }
}

export class EventsRepo extends Effect.Service<EventsRepo>()('@livestore/sync-http/server/EventsRepo', {
  scoped: Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms()
    const table = yield* StoreTableName

    yield* Effect.orDie(
      sql.onDialectOrElse({
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
      }),
    )

    const forUpdate = sql.onDialectOrElse({
      pg: () => sql` FOR UPDATE`,
      mysql: () => sql` FOR UPDATE`,
      // sqlite
      orElse: () => sql``,
    })

    const latestSeqNum = sql<{ max: number }>`select max(seqNum) as max from ${table.sql}${forUpdate}`.pipe(
      Effect.map((rows) => rows[0]?.max ?? 0),
    )

    const push = Effect.fnUntraced(
      function* (
        batch: ReadonlyArray.NonEmptyReadonlyArray<LiveStoreEvent.Global.Encoded>,
      ): Effect.fn.Return<void, ServerAheadError | SqlError.SqlError> {
        const latestSeq = yield* latestSeqNum
        if (batch[0].seqNum <= latestSeq) {
          return yield* Effect.fail(
            new ServerAheadError({
              minimumExpectedNum: EventSequenceNumber.Global.make(latestSeq + 1),
              providedNum: batch[0].seqNum,
            }),
          )
        }
        yield* sql`insert into ${table.sql} ${sql.insert(
          batch.map((event) => ({
            ...event,
            args: JSON.stringify(event.args),
          })),
        )}`.unprepared
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

    return { push, pull } as const
  }),
}) {}
