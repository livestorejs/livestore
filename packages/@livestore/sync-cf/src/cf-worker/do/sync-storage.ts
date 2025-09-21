import { UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Option, Schema, Stream } from '@livestore/utils/effect'
import { SyncMetadata } from '../../common/sync-message-types.ts'
import { type Env, PERSISTENCE_FORMAT_VERSION, type StoreId } from '../shared.ts'
import { eventlogTable } from './sqlite.ts'

export type SyncStorage = {
  dbName: string
  // getHead: Effect.Effect<EventSequenceNumber.GlobalEventSequenceNumber, UnexpectedError>
  getEvents: (
    cursor: number | undefined,
  ) => Effect.Effect<
    {
      total: number
      stream: Stream.Stream<
        ReadonlyArray<{ eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
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
  // Cloudflare's D1 HTTP endpoint rejects JSON responses once they exceed ~1MB.
  // Keep individual SELECT batches comfortably below that threshold so we can
  // serve large histories without tripping the limit.
  const D1_MAX_JSON_RESPONSE_BYTES = 1_000_000
  const D1_RESPONSE_SAFETY_MARGIN_BYTES = 64 * 1024
  const D1_TARGET_RESPONSE_BYTES = D1_MAX_JSON_RESPONSE_BYTES - D1_RESPONSE_SAFETY_MARGIN_BYTES
  const D1_INITIAL_PAGE_SIZE = 256
  const D1_MIN_PAGE_SIZE = 1

  const decodeEventlogRows = Schema.decodeUnknownSync(Schema.Array(eventlogTable.rowSchema))

  const getEvents = (
    cursor: number | undefined,
  ): Effect.Effect<
    {
      total: number
      stream: Stream.Stream<
        ReadonlyArray<{ eventEncoded: LiveStoreEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
        UnexpectedError
      >
    },
    UnexpectedError
  > =>
    Effect.gen(function* () {
      const textEncoder = new TextEncoder()

      const countStatement =
        cursor === undefined
          ? `SELECT COUNT(*) as total FROM ${dbName}`
          : `SELECT COUNT(*) as total FROM ${dbName} WHERE seqNum > ?`

      const countRows = yield* execDb<{ total: number }>((db) => {
        const prepared = db.prepare(countStatement)
        return cursor === undefined ? prepared.all() : prepared.bind(cursor).all()
      })

      const total = Number(countRows[0]?.total ?? 0)

      type State = {
        cursor: number | undefined
        limit: number
        remaining: number
      }

      const initialState: State = {
        cursor,
        limit: D1_INITIAL_PAGE_SIZE,
        remaining: total,
      }

      const stream = Stream.unfoldEffect(initialState, (state) =>
        Effect.gen(function* () {
          if (state.remaining <= 0) {
            return Option.none()
          }

          let chunkLimit = state.limit
          let chunk: Array<any> | undefined

          while (chunk === undefined) {
            const statement =
              state.cursor === undefined
                ? `SELECT * FROM ${dbName} ORDER BY seqNum ASC LIMIT ?`
                : `SELECT * FROM ${dbName} WHERE seqNum > ? ORDER BY seqNum ASC LIMIT ?`

            const rawEvents = yield* execDb((db) => {
              const prepared = db.prepare(statement)
              return state.cursor === undefined
                ? prepared.bind(chunkLimit).all()
                : prepared.bind(state.cursor, chunkLimit).all()
            })

            if (rawEvents.length === 0) {
              return Option.none()
            }

            const encodedSize = textEncoder.encode(JSON.stringify(rawEvents)).byteLength

            if (encodedSize > D1_TARGET_RESPONSE_BYTES && chunkLimit > D1_MIN_PAGE_SIZE) {
              const nextLimit = Math.max(D1_MIN_PAGE_SIZE, Math.floor(chunkLimit / 2))

              if (nextLimit === chunkLimit) {
                chunk = rawEvents
              } else {
                chunkLimit = nextLimit
                continue
              }
            } else {
              chunk = rawEvents
            }
          }

          const decodedChunk = decodeEventlogRows(chunk).map(({ createdAt, ...eventEncoded }) => ({
            eventEncoded,
            metadata: Option.some(SyncMetadata.make({ createdAt })),
          }))

          const emittedCount = decodedChunk.length
          const nextRemaining = Math.max(0, state.remaining - emittedCount)
          const nextCursor = chunk[chunk.length - 1]!.seqNum

          const nextState: State = {
            cursor: nextCursor,
            limit: chunkLimit,
            remaining: nextRemaining,
          }

          return Option.some<[
            ReadonlyArray<{
              eventEncoded: LiveStoreEvent.AnyEncodedGlobal
              metadata: Option.Option<SyncMetadata>
            }>,
            State,
          ]>([
            decodedChunk,
            nextState,
          ])
        }),
      )

      return {
        total,
        stream,
      }
    }).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/sync-cf:durable-object:getEvents', { attributes: { dbName, cursor } }),
    )

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
    }).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/sync-cf:durable-object:appendEvents', {
        attributes: { dbName, batchLength: batch.length },
      }),
    )

  const resetStore = Effect.promise(() => ctx.storage.deleteAll()).pipe(
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/sync-cf:durable-object:resetStore'),
  )

  return {
    dbName,
    // getHead,
    getEvents,
    appendEvents,
    resetStore,
  }
}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')
