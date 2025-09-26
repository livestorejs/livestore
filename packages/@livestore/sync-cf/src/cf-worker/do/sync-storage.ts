import { UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'
import { SyncMetadata } from '../../common/sync-message-types.ts'
import { PERSISTENCE_FORMAT_VERSION, type StoreId } from '../shared.ts'
import { eventlogTable } from './sqlite.ts'

export type SyncStorage = {
  dbName: string
  getEvents: (cursor: number | undefined) => Effect.Effect<
    {
      total: number
      stream: Stream.Stream<
        { eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> },
        UnexpectedError
      >
    },
    UnexpectedError
  >
  appendEvents: (
    batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
    createdAt: string,
  ) => Effect.Effect<void, UnexpectedError>
  resetStore: Effect.Effect<void, UnexpectedError>
}

export const makeStorage = (
  ctx: CfTypes.DurableObjectState,
  storeId: StoreId,
  engine: { _tag: 'd1'; db: CfTypes.D1Database } | { _tag: 'do-sqlite' },
): SyncStorage => {
  const dbName = `eventlog_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`

  const execDb = <T>(cb: (db: CfTypes.D1Database) => Promise<CfTypes.D1Result<T>>) =>
    Effect.tryPromise({
      try: () => cb(engine._tag === 'd1' ? engine.db : (undefined as never)),
      catch: (error) => new UnexpectedError({ cause: error, payload: { dbName } }),
    }).pipe(
      Effect.map((_) => _.results),
      Effect.withSpan('@livestore/sync-cf:durable-object:execDb'),
    )

  // Cloudflare's D1 HTTP endpoint rejects JSON responses once they exceed ~1MB.
  // Keep individual SELECT batches comfortably below that threshold so we can
  // serve large histories without tripping the limit.
  const D1_MAX_JSON_RESPONSE_BYTES = 1_000_000
  const D1_RESPONSE_SAFETY_MARGIN_BYTES = 64 * 1024
  const D1_TARGET_RESPONSE_BYTES = D1_MAX_JSON_RESPONSE_BYTES - D1_RESPONSE_SAFETY_MARGIN_BYTES
  const D1_INITIAL_PAGE_SIZE = 256
  const D1_MIN_PAGE_SIZE = 1

  const decodeEventlogRows = Schema.decodeUnknownSync(Schema.Array(eventlogTable.rowSchema))
  const textEncoder = new TextEncoder()

  const decreaseLimit = (limit: number) => Math.max(D1_MIN_PAGE_SIZE, Math.floor(limit / 2))
  const increaseLimit = (limit: number) => Math.min(D1_INITIAL_PAGE_SIZE, limit * 2)

  const computeNextLimit = (limit: number, encodedSize: number) => {
    if (encodedSize > D1_TARGET_RESPONSE_BYTES && limit > D1_MIN_PAGE_SIZE) {
      const next = decreaseLimit(limit)
      return next === limit ? limit : next
    }

    if (encodedSize < D1_TARGET_RESPONSE_BYTES / 2 && limit < D1_INITIAL_PAGE_SIZE) {
      const next = increaseLimit(limit)
      return next === limit ? limit : next
    }

    return limit
  }

  const getEventsD1 = (
    cursor: number | undefined,
  ): Effect.Effect<
    {
      total: number
      stream: Stream.Stream<
        { eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> },
        UnexpectedError
      >
    },
    UnexpectedError
  > =>
    Effect.gen(function* () {
      const countStatement =
        cursor === undefined
          ? `SELECT COUNT(*) as total FROM ${dbName}`
          : `SELECT COUNT(*) as total FROM ${dbName} WHERE seqNum > ?`

      const countRows = yield* execDb<{ total: number }>((db) => {
        const prepared = db.prepare(countStatement)
        return cursor === undefined ? prepared.all() : prepared.bind(cursor).all()
      })

      const total = Number(countRows[0]?.total ?? 0)

      type State = { cursor: number | undefined; limit: number }
      type EmittedEvent = { eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }

      const initialState: State = { cursor, limit: D1_INITIAL_PAGE_SIZE }

      const fetchPage = (
        state: State,
      ): Effect.Effect<Option.Option<readonly [Chunk.Chunk<EmittedEvent>, State]>, UnexpectedError> =>
        Effect.gen(function* () {
          const statement =
            state.cursor === undefined
              ? `SELECT * FROM ${dbName} ORDER BY seqNum ASC LIMIT ?`
              : `SELECT * FROM ${dbName} WHERE seqNum > ? ORDER BY seqNum ASC LIMIT ?`

          const rawEvents = yield* execDb((db) => {
            const prepared = db.prepare(statement)
            return state.cursor === undefined
              ? prepared.bind(state.limit).all()
              : prepared.bind(state.cursor, state.limit).all()
          })

          if (rawEvents.length === 0) {
            return Option.none()
          }

          const encodedSize = textEncoder.encode(JSON.stringify(rawEvents)).byteLength

          if (encodedSize > D1_TARGET_RESPONSE_BYTES && state.limit > D1_MIN_PAGE_SIZE) {
            const nextLimit = decreaseLimit(state.limit)

            if (nextLimit !== state.limit) {
              return yield* fetchPage({ cursor: state.cursor, limit: nextLimit })
            }
          }

          const decodedRows = Chunk.fromIterable(decodeEventlogRows(rawEvents))

          const eventsChunk = Chunk.map(decodedRows, ({ createdAt, ...eventEncoded }) => ({
            eventEncoded,
            metadata: Option.some(SyncMetadata.make({ createdAt })),
          }))

          const lastSeqNum = Chunk.unsafeLast(decodedRows).seqNum
          const nextState: State = { cursor: lastSeqNum, limit: computeNextLimit(state.limit, encodedSize) }

          return Option.some([eventsChunk, nextState] as const)
        })

      const stream = Stream.unfoldChunkEffect(initialState, fetchPage)

      return { total, stream }
    }).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/sync-cf:durable-object:getEvents', { attributes: { dbName, cursor, engine: engine._tag } }),
    )

  const appendEventsD1: SyncStorage['appendEvents'] = (batch, createdAt) =>
    Effect.gen(function* () {
      // If there are no events, do nothing.
      if (batch.length === 0) return

      // CF D1 limits:
      // Maximum bound parameters per query	100, Maximum arguments per SQL function	32
      // Thus we need to split the batch into chunks of max (100/7=)14 events each.
      const CHUNK_SIZE = 14

      for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
        const chunk = batch.slice(i, i + CHUNK_SIZE)

        // Create a list of placeholders ("(?, ?, ?, ?, ?, ?, ?)"), corresponding to each event.
        const valuesPlaceholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
        const sql = `INSERT INTO ${dbName} (seqNum, parentSeqNum, args, name, createdAt, clientId, sessionId) VALUES ${valuesPlaceholders}`
        // Flatten the event properties into a parameters array.
        const params = chunk.flatMap((event) => [
          event.seqNum,
          event.parentSeqNum,
          event.args === undefined ? null : JSON.stringify(event.args),
          event.name,
          createdAt,
          event.clientId,
          event.sessionId,
        ])

        yield* execDb((db) =>
          db
            .prepare(sql)
            .bind(...params)
            .run(),
        )
      }
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/sync-cf:durable-object:appendEvents', {
        attributes: { dbName, batchLength: batch.length, engine: engine._tag },
      }),
    )

  const resetStore = Effect.promise(() => ctx.storage.deleteAll()).pipe(
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/sync-cf:durable-object:resetStore'),
  )

  // DO SQLite engine implementation
  const getEventsDoSqlite = (
    cursor: number | undefined,
  ): Effect.Effect<
    {
      total: number
      stream: Stream.Stream<
        { eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> },
        UnexpectedError
      >
    },
    UnexpectedError
  > =>
    Effect.gen(function* () {
      const selectCountSql =
        cursor === undefined
          ? `SELECT COUNT(*) as total FROM "${dbName}"`
          : `SELECT COUNT(*) as total FROM "${dbName}" WHERE seqNum > ?`

      let total = 0
      try {
        const cursorIter =
          cursor === undefined
            ? ctx.storage.sql.exec(selectCountSql)
            : ctx.storage.sql.exec(selectCountSql, cursor)
        for (const row of cursorIter) {
          total = Number((row as any).total ?? 0)
        }
      } catch (error) {
        return yield* Effect.fail(new UnexpectedError({ cause: error, payload: { dbName, stage: 'count' } }))
      }

      type State = { cursor: number | undefined }
      type EmittedEvent = { eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }

      const DO_PAGE_SIZE = 256
      const initialState: State = { cursor }

      const fetchPage = (
        state: State,
      ): Effect.Effect<Option.Option<readonly [Chunk.Chunk<EmittedEvent>, State]>, UnexpectedError> =>
        Effect.try({
          try: () => {
            const sql =
              state.cursor === undefined
                ? `SELECT * FROM "${dbName}" ORDER BY seqNum ASC LIMIT ?`
                : `SELECT * FROM "${dbName}" WHERE seqNum > ? ORDER BY seqNum ASC LIMIT ?`

            const iter =
              state.cursor === undefined
                ? ctx.storage.sql.exec(sql, DO_PAGE_SIZE)
                : ctx.storage.sql.exec(sql, state.cursor, DO_PAGE_SIZE)

            const rows: any[] = []
            for (const row of iter) rows.push(row)

            if (rows.length === 0) {
              return Option.none()
            }

            const decodedRows = Chunk.fromIterable(decodeEventlogRows(rows))
            const eventsChunk = Chunk.map(decodedRows, ({ createdAt, ...eventEncoded }) => ({
              eventEncoded,
              metadata: Option.some(SyncMetadata.make({ createdAt })),
            }))

            const lastSeqNum = Chunk.unsafeLast(decodedRows).seqNum
            const nextState: State = { cursor: lastSeqNum }

            return Option.some([eventsChunk, nextState] as const)
          },
          catch: (error) => new UnexpectedError({ cause: error, payload: { dbName, stage: 'select' } }),
        })

      const stream = Stream.unfoldChunkEffect(initialState, fetchPage)

      return { total, stream }
    }).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/sync-cf:durable-object:getEvents', { attributes: { dbName, cursor, engine: engine._tag } }),
    )

  const appendEventsDoSqlite: SyncStorage['appendEvents'] = (batch, createdAt) =>
    Effect.try({
      try: () => {
        if (batch.length === 0) return
        // Keep params per statement within conservative limits (align with D1 bound params ~100)
        const CHUNK_SIZE = 14
        for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
          const chunk = batch.slice(i, i + CHUNK_SIZE)
          const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
          const sql = `INSERT INTO "${dbName}" (seqNum, parentSeqNum, args, name, createdAt, clientId, sessionId) VALUES ${placeholders}`
          const params = chunk.flatMap((event) => [
            event.seqNum,
            event.parentSeqNum,
            event.args === undefined ? null : JSON.stringify(event.args),
            event.name,
            createdAt,
            event.clientId,
            event.sessionId,
          ])
          ctx.storage.sql.exec(sql, ...params)
        }
      },
      catch: (error) => new UnexpectedError({ cause: error, payload: { dbName, stage: 'insert' } }),
    }).pipe(
      Effect.withSpan('@livestore/sync-cf:durable-object:appendEvents', {
        attributes: { dbName, batchLength: batch.length, engine: engine._tag },
      }),
      UnexpectedError.mapToUnexpectedError,
    )

  if (engine._tag === 'd1') {
    return { dbName, getEvents: getEventsD1, appendEvents: appendEventsD1, resetStore }
  }

  return { dbName, getEvents: getEventsDoSqlite, appendEvents: appendEventsDoSqlite, resetStore }
}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')
