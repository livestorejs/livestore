import { DurableObject } from 'cloudflare:workers'
import { makeColumnSpec, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, type LiveStoreEvent, State } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Logger, LogLevel, Option, Schema, UrlParams } from '@livestore/utils/effect'
import { DurableObject } from 'cloudflare:workers'

import { SearchParamsSchema, WSMessage } from '../common/mod.js'
import type { SyncMetadata } from '../common/ws-message-types.js'

export interface Env {
  DB: D1Database
  ADMIN_SECRET: string
}

type WebSocketClient = WebSocket

const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.BackendToClientMessage))
const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.ClientToBackendMessage))
const decodeIncomingMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.ClientToBackendMessage))

export const eventlogTable = State.SQLite.table({
  // NOTE actual table name is determined at runtime
  name: 'eventlog_$PERSISTENCE_FORMAT_VERSION_$storeId',
  columns: {
    seqNum: State.SQLite.integer({ primaryKey: true, schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    parentSeqNum: State.SQLite.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    name: State.SQLite.text({}),
    args: State.SQLite.text({ schema: Schema.parseJson(Schema.Any), nullable: true }),
    /** ISO date format. Currently only used for debugging purposes. */
    createdAt: State.SQLite.text({}),
    clientId: State.SQLite.text({}),
    sessionId: State.SQLite.text({}),
  },
})

const WebSocketAttachmentSchema = Schema.parseJson(
  Schema.Struct({
    storeId: Schema.String,
    payload: Schema.optional(Schema.JsonValue),
  }),
)

export const PULL_CHUNK_SIZE = 100

/**
 * Needs to be bumped when the storage format changes (e.g. eventlogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 7

export type MakeDurableObjectClassOptions = {
  onPush?: (
    message: WSMessage.PushReq,
    context: { storeId: string; payload?: Schema.JsonValue },
  ) => Effect.Effect<void> | Promise<void>
  onPushRes?: (message: WSMessage.PushAck | WSMessage.Error) => Effect.Effect<void> | Promise<void>
  onPull?: (
    message: WSMessage.PullReq,
    context: { storeId: string; payload?: Schema.JsonValue },
  ) => Effect.Effect<void> | Promise<void>
  onPullRes?: (message: WSMessage.PullRes | WSMessage.Error) => Effect.Effect<void> | Promise<void>
}

export type MakeDurableObjectClass = (options?: MakeDurableObjectClassOptions) => {
  new (ctx: DurableObjectState, env: Env): DurableObject<Env>
}

export const makeDurableObject: MakeDurableObjectClass = (options) => {
  return class WebSocketServerBase extends DurableObject<Env> {
    /** Needed to prevent concurrent pushes */
    private pushSemaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)

    private currentHead: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' = 'uninitialized'

    fetch = async (request: Request) =>
      Effect.sync(() => {
        const { storeId, payload } = getRequestSearchParams(request)
        const storage = makeStorage(this.ctx, this.env, storeId)

        const { 0: client, 1: server } = new WebSocketPair()

        // Since we're using websocket hibernation, we need to remember the storeId for subsequent `webSocketMessage` calls
        server.serializeAttachment(Schema.encodeSync(WebSocketAttachmentSchema)({ storeId, payload }))

        // See https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server

        this.ctx.acceptWebSocket(server)

        this.ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair(
            encodeIncomingMessage(WSMessage.Ping.make({ requestId: 'ping' })),
            encodeOutgoingMessage(WSMessage.Pong.make({ requestId: 'ping' })),
          ),
        )

        const colSpec = makeColumnSpec(eventlogTable.sqliteDef.ast)
        this.env.DB.exec(`CREATE TABLE IF NOT EXISTS ${storage.dbName} (${colSpec}) strict`)

        return new Response(null, {
          status: 101,
          webSocket: client,
        })
      }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)

    webSocketMessage = (ws: WebSocketClient, message: ArrayBuffer | string) => {
      console.log('webSocketMessage', message)
      const decodedMessageRes = decodeIncomingMessage(message)

      if (decodedMessageRes._tag === 'Left') {
        console.error('Invalid message received', decodedMessageRes.left)
        return
      }

      const decodedMessage = decodedMessageRes.right
      const requestId = decodedMessage.requestId

      return Effect.gen(this, function* () {
        const { storeId, payload } = yield* Schema.decode(WebSocketAttachmentSchema)(ws.deserializeAttachment())
        const storage = makeStorage(this.ctx, this.env, storeId)

        try {
          switch (decodedMessage._tag) {
            // TODO allow pulling concurrently to not block incoming push requests
            case 'WSMessage.PullReq': {
              if (options?.onPull) {
                yield* Effect.tryAll(() => options.onPull!(decodedMessage, { storeId, payload }))
              }

              const respond = (message: WSMessage.PullRes) =>
                Effect.gen(function* () {
                  if (options?.onPullRes) {
                    yield* Effect.tryAll(() => options.onPullRes!(message))
                  }
                  ws.send(encodeOutgoingMessage(message))
                })

              const cursor = decodedMessage.cursor

              // TODO use streaming
              const remainingEvents = yield* storage.getEvents(cursor)

              // Send at least one response, even if there are no events
              const batches =
                remainingEvents.length === 0
                  ? [[]]
                  : Array.from({ length: Math.ceil(remainingEvents.length / PULL_CHUNK_SIZE) }, (_, i) =>
                      remainingEvents.slice(i * PULL_CHUNK_SIZE, (i + 1) * PULL_CHUNK_SIZE),
                    )

              for (const [index, batch] of batches.entries()) {
                const remaining = Math.max(0, remainingEvents.length - (index + 1) * PULL_CHUNK_SIZE)
                yield* respond(WSMessage.PullRes.make({ batch, remaining, requestId: { context: 'pull', requestId } }))
              }

              break
            }
            case 'WSMessage.PushReq': {
              const respond = (message: WSMessage.PushAck | WSMessage.Error) =>
                Effect.gen(function* () {
                  if (options?.onPushRes) {
                    yield* Effect.tryAll(() => options.onPushRes!(message))
                  }
                  ws.send(encodeOutgoingMessage(message))
                })

              if (decodedMessage.batch.length === 0) {
                yield* respond(WSMessage.PushAck.make({ requestId }))
                return
              }

              yield* this.pushSemaphore.take(1)

              if (options?.onPush) {
                yield* Effect.tryAll(() => options.onPush!(decodedMessage, { storeId, payload }))
              }

              // TODO check whether we could use the Durable Object storage for this to speed up the lookup
              // const expectedParentNum = yield* storage.getHead

              let currentHead: EventSequenceNumber.GlobalEventSequenceNumber
              if (this.currentHead === 'uninitialized') {
                const currentHeadFromStorage = yield* Effect.promise(() => this.ctx.storage.get('currentHead'))
                // console.log('currentHeadFromStorage', currentHeadFromStorage)
                if (currentHeadFromStorage === undefined) {
                  // console.log('currentHeadFromStorage is null, getting from D1')
                  // currentHead = yield* storage.getHead
                  // console.log('currentHeadFromStorage is null, using root')
                  currentHead = EventSequenceNumber.ROOT.global
                } else {
                  currentHead = currentHeadFromStorage as EventSequenceNumber.GlobalEventSequenceNumber
                }
              } else {
                // console.log('currentHead is already initialized', this.currentHead)
                currentHead = this.currentHead
              }

              // TODO handle clientId unique conflict
              // Validate the batch
              const firstEvent = decodedMessage.batch[0]!
              if (firstEvent.parentSeqNum !== currentHead) {
                const err = WSMessage.Error.make({
                  message: `Invalid parent event number. Received e${firstEvent.parentSeqNum} but expected e${currentHead}`,
                  requestId,
                })

                yield* Effect.logError(err)

                yield* respond(err)
                yield* this.pushSemaphore.release(1)
                return
              }

              yield* respond(WSMessage.PushAck.make({ requestId }))

              const createdAt = new Date().toISOString()

              // NOTE we're not waiting for this to complete yet to allow the broadcast to happen right away
              // while letting the async storage write happen in the background
              const storeFiber = yield* storage.appendEvents(decodedMessage.batch, createdAt).pipe(Effect.fork)

              this.currentHead = decodedMessage.batch.at(-1)!.seqNum
              yield* Effect.promise(() => this.ctx.storage.put('currentHead', this.currentHead))

              yield* this.pushSemaphore.release(1)

              const connectedClients = this.ctx.getWebSockets()

              // console.debug(`Broadcasting push batch to ${this.subscribedWebSockets.size} clients`)
              if (connectedClients.length > 0) {
                // TODO refactor to batch api
                const pullRes = WSMessage.PullRes.make({
                  batch: decodedMessage.batch.map((eventEncoded) => ({
                    eventEncoded,
                    metadata: Option.some({ createdAt }),
                  })),
                  remaining: 0,
                  requestId: { context: 'push', requestId },
                })
                const pullResEnc = encodeOutgoingMessage(pullRes)

                // Only calling once for now.
                if (options?.onPullRes) {
                  yield* Effect.tryAll(() => options.onPullRes!(pullRes))
                }

                // NOTE we're also sending the pullRes to the pushing ws client as a confirmation
                for (const conn of connectedClients) {
                  conn.send(pullResEnc)
                }
              }

              // Wait for the storage write to complete before finishing this request
              yield* storeFiber

              break
            }
            case 'WSMessage.AdminResetRoomReq': {
              if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
                ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
                return
              }

              yield* storage.resetStore
              ws.send(encodeOutgoingMessage(WSMessage.AdminResetRoomRes.make({ requestId })))

              break
            }
            case 'WSMessage.AdminInfoReq': {
              if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
                ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
                return
              }

              ws.send(
                encodeOutgoingMessage(
                  WSMessage.AdminInfoRes.make({ requestId, info: { durableObjectId: this.ctx.id.toString() } }),
                ),
              )

              break
            }
            default: {
              console.error('unsupported message', decodedMessage)
              return shouldNeverHappen()
            }
          }
        } catch (error: any) {
          ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: error.message, requestId })))
        }
      }).pipe(
        Effect.withSpan(`@livestore/sync-cf:durable-object:webSocketMessage:${decodedMessage._tag}`, {
          attributes: { requestId },
        }),
        Effect.tapCauseLogPretty,
        Effect.tapErrorCause((cause) =>
          Effect.sync(() =>
            ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: cause.toString(), requestId }))),
          ),
        ),
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.provide(Logger.prettyWithThread('durable-object')),
        Effect.runPromise,
      )
    }

    webSocketClose = async (ws: WebSocketClient, code: number, _reason: string, _wasClean: boolean) => {
      // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
      ws.close(code, 'Durable Object is closing WebSocket')
    }
  }
}

type SyncStorage = {
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

const makeStorage = (ctx: DurableObjectState, env: Env, storeId: string): SyncStorage => {
  const dbName = `eventlog_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`

  const execDb = <T>(cb: (db: D1Database) => Promise<D1Result<T>>) =>
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
          metadata: Option.some({ createdAt }),
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

  const resetStore = Effect.gen(function* () {
    yield* Effect.promise(() => ctx.storage.deleteAll())
  }).pipe(UnexpectedError.mapToUnexpectedError)

  return {
    dbName,
    // getHead,
    getEvents,
    appendEvents,
    resetStore,
  }
}

const getRequestSearchParams = (request: Request) => {
  const url = new URL(request.url)
  const urlParams = UrlParams.fromInput(url.searchParams)
  const paramsResult = UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.runSync)
  return paramsResult
}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')
