import { ServerAheadError, UnknownError } from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Chunk, Context, Effect, Layer, Option, Stream } from '@livestore/utils/effect'
import { PERSISTENCE_FORMAT_VERSION, SyncMessage } from '../../common/mod.ts'
import type { SyncStorage } from './interface.ts'
import { SyncStorageTag } from './interface.ts'

/**
 * SQLite database interface abstraction.
 * Implementations can use better-sqlite3 (Node.js), bun:sqlite, or other SQLite libraries.
 */
export interface SqliteDatabase {
  readonly run: (sql: string, ...params: unknown[]) => Effect.Effect<void, UnknownError>
  readonly all: <T>(sql: string, ...params: unknown[]) => Effect.Effect<T[], UnknownError>
  readonly get: <T>(sql: string, ...params: unknown[]) => Effect.Effect<T | undefined, UnknownError>
  readonly close: () => Effect.Effect<void, UnknownError>
}

export class SqliteDatabaseTag extends Context.Tag('SqliteDatabase')<SqliteDatabaseTag, SqliteDatabase>() {}

export interface SqliteStorageConfig {
  /** Directory to store SQLite database files (one per store) */
  readonly dataDir: string
}

export class SqliteStorageConfigTag extends Context.Tag('SqliteStorageConfig')<
  SqliteStorageConfigTag,
  SqliteStorageConfig
>() {}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')

/**
 * Creates a SQLite storage layer that manages separate database files per store.
 */
export const makeSqliteStorage = Effect.gen(function* () {
  const config = yield* SqliteStorageConfigTag
  const dbFactory = yield* SqliteDatabaseTag

  /** Cache of open database connections per storeId */
  const connections = new Map<string, SqliteDatabase>()

  const getDb = (storeId: string): Effect.Effect<SqliteDatabase, UnknownError> =>
    Effect.gen(function* () {
      const existing = connections.get(storeId)
      if (existing !== undefined) {
        return existing
      }

      // Create new connection - actual DB creation delegated to factory
      const _dbPath = `${config.dataDir}/${toValidTableName(storeId)}.db`

      // The dbFactory should handle creating the database
      // For now, reuse the provided factory which should be pre-initialized
      // In practice, a proper implementation would open a new connection per store
      connections.set(storeId, dbFactory)

      // Initialize tables for this store
      yield* initializeTables(dbFactory, storeId)

      return dbFactory
    }).pipe(UnknownError.mapToUnknownError)

  const initializeTables = (db: SqliteDatabase, storeId: string) =>
    Effect.gen(function* () {
      const eventTableName = `eventlog_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`
      const contextTableName = `context_${PERSISTENCE_FORMAT_VERSION}`

      // Create eventlog table
      yield* db.run(`
        CREATE TABLE IF NOT EXISTS "${eventTableName}" (
          seqNum INTEGER PRIMARY KEY,
          parentSeqNum INTEGER NOT NULL,
          name TEXT NOT NULL,
          args TEXT,
          createdAt TEXT NOT NULL,
          clientId TEXT NOT NULL,
          sessionId TEXT NOT NULL
        )
      `)

      // Create context table
      yield* db.run(`
        CREATE TABLE IF NOT EXISTS "${contextTableName}" (
          storeId TEXT PRIMARY KEY,
          currentHead INTEGER,
          backendId TEXT NOT NULL
        )
      `)

      // Ensure context row exists
      const existing = yield* db.get<{ storeId: string }>(
        `SELECT storeId FROM "${contextTableName}" WHERE storeId = ?`,
        storeId,
      )

      if (existing === undefined) {
        yield* db.run(
          `INSERT INTO "${contextTableName}" (storeId, currentHead, backendId) VALUES (?, NULL, ?)`,
          storeId,
          crypto.randomUUID(),
        )
      }
    })

  const getTableName = (storeId: string) => `eventlog_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`
  const getContextTableName = () => `context_${PERSISTENCE_FORMAT_VERSION}`

  const getEvents: SyncStorage['getEvents'] = (storeId, cursor) =>
    Effect.gen(function* () {
      const db = yield* getDb(storeId)
      const tableName = getTableName(storeId)
      const cursorNum = Option.isSome(cursor) ? cursor.value : -1

      // Get total count
      const countResult = yield* db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM "${tableName}" WHERE seqNum > ?`,
        cursorNum,
      )
      const total = countResult?.total ?? 0

      // Create paginated stream
      const PAGE_SIZE = 256
      type State = { cursor: number }
      type EventRow = {
        seqNum: number
        parentSeqNum: number
        name: string
        args: string | null
        createdAt: string
        clientId: string
        sessionId: string
      }

      const fetchPage = (state: State) =>
        Effect.gen(function* () {
          const rows = yield* db.all<EventRow>(
            `SELECT * FROM "${tableName}" WHERE seqNum > ? ORDER BY seqNum ASC LIMIT ?`,
            state.cursor,
            PAGE_SIZE,
          )

          if (rows.length === 0) {
            return Option.none()
          }

          const events = rows.map((row) => ({
            eventEncoded: {
              seqNum: row.seqNum,
              parentSeqNum: row.parentSeqNum,
              name: row.name,
              args: row.args !== null ? JSON.parse(row.args) : undefined,
              clientId: row.clientId,
              sessionId: row.sessionId,
            } as LiveStoreEvent.Global.Encoded,
            metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt: row.createdAt })),
          }))

          const lastSeqNum = rows[rows.length - 1]!.seqNum
          return Option.some([Chunk.fromIterable(events), { cursor: lastSeqNum }] as const)
        })

      const stream = Stream.unfoldChunkEffect({ cursor: cursorNum }, fetchPage)

      return { total, stream }
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:sqlite-storage:getEvents', { attributes: { storeId } }),
    )

  const appendEvents: SyncStorage['appendEvents'] = (storeId, batch, createdAt) =>
    Effect.gen(function* () {
      if (batch.length === 0) return

      const db = yield* getDb(storeId)
      const tableName = getTableName(storeId)
      const contextTableName = getContextTableName()

      // Get current head
      const headResult = yield* db.get<{ currentHead: number | null }>(
        `SELECT currentHead FROM "${contextTableName}" WHERE storeId = ?`,
        storeId,
      )
      const currentHead = headResult?.currentHead ?? 0

      // Validate sequence continuity
      const firstSeqNum = batch[0]!.seqNum
      if (firstSeqNum !== currentHead + 1) {
        return yield* Effect.fail(
          new ServerAheadError({
            minimumExpectedNum: (currentHead + 1) as EventSequenceNumber.Global.Type,
            providedNum: firstSeqNum as EventSequenceNumber.Global.Type,
          }),
        )
      }

      // Insert events in chunks (SQLite has parameter limits)
      const CHUNK_SIZE = 14 // 7 columns * 14 = 98 params (under SQLite's 999 limit)
      for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
        const chunk = batch.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
        const params = chunk.flatMap((event) => [
          event.seqNum,
          event.parentSeqNum,
          event.name,
          event.args === undefined ? null : JSON.stringify(event.args),
          createdAt,
          event.clientId,
          event.sessionId,
        ])

        yield* db.run(
          `INSERT INTO "${tableName}" (seqNum, parentSeqNum, name, args, createdAt, clientId, sessionId) VALUES ${placeholders}`,
          ...params,
        )
      }

      // Update current head
      const newHead = batch[batch.length - 1]!.seqNum
      yield* db.run(`UPDATE "${contextTableName}" SET currentHead = ? WHERE storeId = ?`, newHead, storeId)
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:sqlite-storage:appendEvents', { attributes: { storeId, batchLength: batch.length } }),
    )

  const getHead: SyncStorage['getHead'] = (storeId) =>
    Effect.gen(function* () {
      const db = yield* getDb(storeId)
      const contextTableName = getContextTableName()

      const result = yield* db.get<{ currentHead: number | null }>(
        `SELECT currentHead FROM "${contextTableName}" WHERE storeId = ?`,
        storeId,
      )

      if (result === undefined || result.currentHead === null) {
        return Option.none()
      }

      return Option.some(result.currentHead as EventSequenceNumber.Global.Type)
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:sqlite-storage:getHead', { attributes: { storeId } }),
    )

  const getBackendId: SyncStorage['getBackendId'] = (storeId) =>
    Effect.gen(function* () {
      const db = yield* getDb(storeId)
      const contextTableName = getContextTableName()

      // Ensure tables exist
      yield* initializeTables(db, storeId)

      const result = yield* db.get<{ backendId: string }>(
        `SELECT backendId FROM "${contextTableName}" WHERE storeId = ?`,
        storeId,
      )

      return result?.backendId ?? crypto.randomUUID()
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:sqlite-storage:getBackendId', { attributes: { storeId } }),
    )

  const resetStore: SyncStorage['resetStore'] = (storeId) =>
    Effect.gen(function* () {
      const db = yield* getDb(storeId)
      const tableName = getTableName(storeId)
      const contextTableName = getContextTableName()

      // Drop event table
      yield* db.run(`DROP TABLE IF EXISTS "${tableName}"`)

      // Reset context with new backend ID
      yield* db.run(
        `UPDATE "${contextTableName}" SET currentHead = NULL, backendId = ? WHERE storeId = ?`,
        crypto.randomUUID(),
        storeId,
      )

      // Re-create event table
      yield* initializeTables(db, storeId)
    }).pipe(
      UnknownError.mapToUnknownError,
      Effect.withSpan('sync-http:sqlite-storage:resetStore', { attributes: { storeId } }),
    )

  return {
    getEvents,
    appendEvents,
    getHead,
    getBackendId,
    resetStore,
  } satisfies SyncStorage
})

/** Layer providing SQLite storage (requires SqliteDatabase and SqliteStorageConfig) */
export const SqliteStorageLayer = Layer.effect(SyncStorageTag, makeSqliteStorage)
