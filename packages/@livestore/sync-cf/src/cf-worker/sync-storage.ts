import { UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Option, Schema } from '@livestore/utils/effect'
import { SyncMetadata } from '../common/sync-message-types.ts'
import { type Env, PERSISTENCE_FORMAT_VERSION, type StoreId } from './shared.ts'
import { eventlogTable } from './sqlite.ts'

export type SyncStorage = {
  dbName: string
  // getHead: Effect.Effect<EventSequenceNumber.GlobalEventSequenceNumber, UnexpectedError>
  getEvents: (
    cursor: number | undefined,
  ) => Effect.Effect<
    ReadonlyArray<{ eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
    UnexpectedError
  >
  appendEvents: (
    batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
    createdAt: string,
  ) => Effect.Effect<void, UnexpectedError>
  resetStore: Effect.Effect<void, UnexpectedError>
}

export const makeStorage = (ctx: CfTypes.DurableObjectState, env: Env, storeId: StoreId): SyncStorage => {
  const dbName = `eventlog_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`

  const execDb = <T>(cb: (db: CfTypes.D1Database) => Promise<CfTypes.D1Result<T>>) =>
    Effect.tryPromise({
      try: () => cb(env.DB),
      catch: (error) => new UnexpectedError({ cause: error, payload: { dbName } }),
    }).pipe(
      Effect.map((_) => _.results),
      Effect.withSpan('@livestore/sync-cf:durable-object:execDb'),
    )

  // const getHead: Effect.Effect<EventSequenceNumber.GlobalEventSequenceNumber, UnexpectedError> = Effect.gen(
  //   function* () {
  //     const result = yield* execDb<{ seqNum: EventSequenceNumber.GlobalEventSequenceNumber }>((db) =>
  //       db.prepare(`SELECT seqNum FROM ${dbName} ORDER BY seqNum DESC LIMIT 1`).all(),
  //     )

  //     return result[0]?.seqNum ?? EventSequenceNumber.ROOT.global
  //   },
  // ).pipe(UnexpectedError.mapToUnexpectedError)

  // TODO support streaming
  const getEvents = (
    cursor: number | undefined,
  ): Effect.Effect<
    ReadonlyArray<{ eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
    UnexpectedError
  > =>
    Effect.gen(function* () {
      const whereClause = cursor === undefined ? '' : `WHERE seqNum > ${cursor}`
      const sql = `SELECT * FROM ${dbName} ${whereClause} ORDER BY seqNum ASC`
      // TODO handle case where `cursor` was not found
      const rawEvents = yield* execDb((db) => db.prepare(sql).all())
      const events = Schema.decodeUnknownSync(Schema.Array(eventlogTable.rowSchema))(rawEvents).map(
        ({ createdAt, ...eventEncoded }) => ({
          eventEncoded,
          metadata: Option.some(SyncMetadata.make({ createdAt })),
        }),
      )
      return events
    }).pipe(UnexpectedError.mapToUnexpectedError)

  const appendEvents: SyncStorage['appendEvents'] = (batch, createdAt) =>
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
    }).pipe(UnexpectedError.mapToUnexpectedError)

  const resetStore = Effect.promise(() => ctx.storage.deleteAll()).pipe(UnexpectedError.mapToUnexpectedError)

  return {
    dbName,
    // getHead,
    getEvents,
    appendEvents,
    resetStore,
  }
}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')
