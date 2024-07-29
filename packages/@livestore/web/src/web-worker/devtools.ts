import { Devtools, liveStoreVersion, UnexpectedError } from '@livestore/common'
import { MUTATION_LOG_META_TABLE, SCHEMA_META_TABLE, SCHEMA_MUTATIONS_META_TABLE } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import {
  Deferred,
  Effect,
  Exit,
  PubSub,
  Queue,
  Runtime,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { makeInMemoryDb } from '../make-in-memory-db.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import { importBytesToDb } from '../sqlite-utils.js'
import type { DevtoolsContextEnabled } from './common.js'
import { InnerWorkerCtx, makeApplyMutation } from './common.js'

type SendMessage = (
  message: Devtools.MessageFromAppHostCoordinator,
  options?: {
    /** Send message even if not connected (e.g. for initial broadcast messages) */
    force: boolean
  },
) => Effect.Effect<void>

export const makeDevtoolsContext = (channelId: string) =>
  Effect.gen(function* () {
    const broadcastCallbacks = new Set<DevtoolsContextEnabled['broadcast']>()

    const connectionScopes = new Set<Scope.CloseableScope>()

    const connect: DevtoolsContextEnabled['connect'] = ({
      coordinatorMessagePort,
      connectionScope,
      storeMessagePortDeferred,
      // TODO remove connectionId if not needed
      // connectionId,
      isLeaderTab,
    }) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<InnerWorkerCtx>()

        connectionScopes.add(connectionScope)

        yield* Effect.addFinalizer(() => Effect.sync(() => connectionScopes.delete(connectionScope)))

        // const storeMessagePortDeferred = yield* Deferred.make<MessagePort>()

        const isConnected = yield* SubscriptionRef.make(false)

        const incomingMessagesPubSub = yield* PubSub.unbounded<Devtools.MessageToAppHostCoordinator>()

        const incomingMessages = Stream.fromPubSub(incomingMessagesPubSub)

        const outgoingMessagesQueue = yield* Queue.unbounded<Devtools.MessageFromAppHostCoordinator>()

        const sendToPort = (msg: typeof Devtools.MessageFromAppHostCoordinator.Type) =>
          Effect.gen(function* () {
            const [encodedMessage, transfers] = yield* Schema.encodeWithTransferables(
              Devtools.MessageFromAppHostCoordinator,
            )(msg)

            yield* Effect.try(() => coordinatorMessagePort.postMessage(encodedMessage, transfers))
          }).pipe(Effect.withSpan('@livestore/web:worker:devtools:sendToDevtools'))

        const sendMessage: SendMessage = (message, options) =>
          Effect.gen(function* () {
            if (options?.force === true || (yield* SubscriptionRef.get(isConnected))) {
              yield* sendToPort(message)
            } else {
              yield* Queue.offer(outgoingMessagesQueue, message)
            }
          }).pipe(
            Effect.withSpan('@livestore/web:worker:devtools:sendToDevtools'),
            Effect.tapCauseLogPretty,
            Effect.orDie,
          )

        broadcastCallbacks.add((message) => sendMessage(message))

        //       currentRunningPortFiberRef.current =
        // Effect.gen(function* () {
        coordinatorMessagePort.addEventListener('message', (event) =>
          Effect.gen(function* () {
            const decodedMsg = yield* Schema.decode(Devtools.MessageToAppHostCoordinator)(event.data)
            // yield* Effect.logDebug('[@livestore/web:worker:devtools] message from port', decodedMsg)

            if (decodedMsg._tag === 'LSD.MessagePortForStoreRes') {
              yield* Deferred.succeed(storeMessagePortDeferred, decodedMsg.port)
            } else {
              yield* PubSub.publish(incomingMessagesPubSub, decodedMsg)
            }
          }).pipe(
            Effect.withSpan('@livestore/web:worker:devtools:onPortMessage'),
            Effect.tapCauseLogPretty,
            Runtime.runFork(runtime),
          ),
        )

        coordinatorMessagePort.start()

        yield* sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion, isLeaderTab }), { force: true })

        yield* sendMessage(Devtools.MessagePortForStoreReq.make({ channelId, liveStoreVersion, requestId: cuid() }), {
          force: true,
        })

        yield* Effect.addFinalizer(() => Effect.sync(() => coordinatorMessagePort.close()))

        yield* listenToDevtools({ incomingMessages, sendMessage, isConnected, connectionScope, channelId, isLeaderTab })
      }).pipe(Effect.withSpan('@livestore/web:worker:devtools:connect'))

    const broadcast: DevtoolsContextEnabled['broadcast'] = (message) =>
      Effect.gen(function* () {
        for (const callback of broadcastCallbacks) {
          yield* callback(message)
        }
      })

    return { enabled: true, channelId, connect, broadcast, connectionScopes } satisfies DevtoolsContextEnabled
  })

const listenToDevtools = ({
  incomingMessages,
  sendMessage,
  isConnected,
  connectionScope,
  channelId,
  isLeaderTab,
}: {
  incomingMessages: Stream.Stream<Devtools.MessageToAppHostCoordinator>
  sendMessage: SendMessage
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  connectionScope: Scope.CloseableScope
  channelId: string
  isLeaderTab: boolean
}) =>
  Effect.gen(function* () {
    const innerWorkerCtx = yield* InnerWorkerCtx
    const { sync, sqlite3, db, dbLog, schema, shutdownStateSubRef } = innerWorkerCtx

    const applyMutation = makeApplyMutation(innerWorkerCtx, () => new Date().toISOString(), db.dbRef.current)

    yield* incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('[@livestore/web:worker:devtools] incomingMessage', decodedEvent)

          if (decodedEvent._tag === 'LSD.DevtoolsReady') {
            if ((yield* isConnected.get) === false) {
              yield* sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion, isLeaderTab }), {
                force: true,
              })
            }
            return
          }

          if (decodedEvent._tag === 'LSD.DevtoolsConnected') {
            if (yield* isConnected.get) {
              console.warn('devtools already connected')
              return
            }

            if (sync?.impl !== undefined) {
              const networkStatus = yield* sync.impl.isConnected.get.pipe(
                Effect.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
              )

              // TODO is this needed here?
              yield* sendMessage(
                Devtools.NetworkStatusChanged.make({
                  channelId: channelId,
                  networkStatus,
                  liveStoreVersion,
                }),
              )
            }

            yield* SubscriptionRef.set(isConnected, true)
            return
          }

          const { requestId } = decodedEvent

          if (decodedEvent.channelId !== channelId) return

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* sendMessage(Devtools.Pong.make({ requestId, channelId, liveStoreVersion }))
              return
            }
            case 'LSD.Disconnect': {
              yield* SubscriptionRef.set(isConnected, false)

              // TODO consider using `return yield* Effect.interrupt` instead
              yield* Scope.close(connectionScope, Exit.void)

              // TODO is there a better place for this?
              yield* sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion, isLeaderTab }), {
                force: true,
              })

              return
            }
            case 'LSD.SnapshotReq': {
              const data = yield* db.export

              yield* sendMessage(Devtools.SnapshotRes.make({ snapshot: data, requestId, channelId, liveStoreVersion }))

              return
            }
            case 'LSD.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
                tmpDb.capi = sqlite3.capi

                importBytesToDb(sqlite3, tmpDb, data)

                const tmpInMemoryDb = makeInMemoryDb(sqlite3, tmpDb)
                const tableNameResults = tmpInMemoryDb
                  .prepare(`select name from sqlite_master where type = 'table'`)
                  .select<{ name: string }>(undefined)

                tableNames = new Set(tableNameResults.map((_) => _.name))

                tmpDb.close()
              } catch (e) {
                yield* sendMessage(
                  Devtools.LoadDatabaseFileRes.make({
                    requestId,
                    channelId,
                    liveStoreVersion,
                    status: 'unsupported-file',
                  }),
                )

                return
              }

              if (tableNames.has(MUTATION_LOG_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                yield* dbLog.import(data)

                yield* db.destroy
              } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_MUTATIONS_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                yield* db.import(data)
              } else {
                yield* sendMessage(
                  Devtools.LoadDatabaseFileRes.make({
                    requestId,
                    channelId,
                    liveStoreVersion,
                    status: 'unsupported-database',
                  }),
                )
                return
              }

              yield* sendMessage(
                Devtools.LoadDatabaseFileRes.make({ requestId, channelId, liveStoreVersion, status: 'ok' }),
              )

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutdown-requested')

              return
            }
            case 'LSD.ResetAllDataReq': {
              const { mode } = decodedEvent

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

              yield* db.destroy

              if (mode === 'all-data') {
                yield* dbLog.destroy
              }

              yield* sendMessage(Devtools.ResetAllDataRes.make({ requestId, channelId, liveStoreVersion }))

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutdown-requested')

              return
            }
            case 'LSD.DatabaseFileInfoReq': {
              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`
              const dbFileSize = db.dbRef.current.selectValue(dbSizeQuery) as number
              const mutationLogFileSize = dbLog.dbRef.current.selectValue(dbSizeQuery) as number

              yield* sendMessage(
                Devtools.DatabaseFileInfoRes.make({
                  dbFileSize,
                  mutationLogFileSize,
                  requestId,
                  channelId,
                  liveStoreVersion,
                }),
              )

              return
            }
            case 'LSD.MutationLogReq': {
              const mutationLog = yield* dbLog.export

              yield* sendMessage(Devtools.MutationLogRes.make({ mutationLog, requestId, channelId, liveStoreVersion }))

              return
            }
            case 'LSD.RunMutationReq': {
              const { mutationEventEncoded, persisted } = decodedEvent

              const mutationDef =
                schema.mutations.get(mutationEventEncoded.mutation) ??
                shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

              yield* applyMutation(mutationEventEncoded, {
                syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
                shouldBroadcast: true,
                persisted,
              })

              yield* sendMessage(Devtools.RunMutationRes.make({ requestId, channelId, liveStoreVersion }))
            }
          }
        }).pipe(Effect.withSpan(`@livestore/web:worker:onDevtoolsMessage:${decodedEvent._tag}`)),
      ),
      UnexpectedError.mapToUnexpectedErrorStream,
      Stream.runDrain,
    )
  })
