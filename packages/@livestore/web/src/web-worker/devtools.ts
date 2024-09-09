import { Devtools, IntentionalShutdownCause, liveStoreVersion, UnexpectedError } from '@livestore/common'
import { MUTATION_LOG_META_TABLE, SCHEMA_META_TABLE, SCHEMA_MUTATIONS_META_TABLE } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import {
  Deferred,
  Effect,
  FiberMap,
  FiberSet,
  Option,
  PubSub,
  Queue,
  Stream,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'

import { WaSqlite } from '../sqlite/index.js'
import { makeSynchronousDatabase } from '../sqlite/make-sync-db.js'
import type { DevtoolsContextEnabled, PersistenceInfoPair } from './common.js'
import { InnerWorkerCtx, makeApplyMutation } from './common.js'
import { makeShutdownChannel } from './shutdown-channel.js'

type SendMessage = (
  message: Devtools.MessageFromAppHostCoordinator,
  options?: {
    /** Send message even if not connected (e.g. for initial broadcast messages) */
    force: boolean
  },
) => Effect.Effect<void>

export const makeDevtoolsContext = Effect.gen(function* () {
  const broadcastCallbacks = new Set<DevtoolsContextEnabled['broadcast']>()

  const connections = yield* FiberSet.make()

  const connect: DevtoolsContextEnabled['connect'] = ({
    coordinatorMessagePort,
    disconnect,
    storeMessagePortDeferred,
    storeId,
    appHostId,
    isLeaderTab,
    persistenceInfo,
  }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(false)

      const incomingMessagesPubSub = yield* PubSub.unbounded<Devtools.MessageToAppHostCoordinator>().pipe(
        Effect.acquireRelease(PubSub.shutdown),
      )

      const incomingMessages = Stream.fromPubSub(incomingMessagesPubSub)

      const outgoingMessagesQueue = yield* Queue.unbounded<Devtools.MessageFromAppHostCoordinator>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const portChannel = yield* WebChannel.messagePortChannel({
        port: coordinatorMessagePort,
        sendSchema: Devtools.MessageFromAppHostCoordinator,
        listenSchema: Devtools.MessageToAppHostCoordinator,
      })

      const sendMessage: SendMessage = (message, options) =>
        Effect.gen(function* () {
          if (options?.force === true || (yield* SubscriptionRef.get(isConnected))) {
            yield* portChannel.send(message)
          } else {
            yield* Queue.offer(outgoingMessagesQueue, message)
          }
        }).pipe(
          Effect.withSpan('@livestore/web:worker:devtools:sendToDevtools'),
          Effect.interruptible,
          Effect.ignoreLogged,
        )

      broadcastCallbacks.add((message) => sendMessage(message))

      yield* portChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((msg) =>
          Effect.gen(function* () {
            // yield* Effect.logDebug(`[@livestore/web:worker:devtools] message from port: ${msg._tag}`, msg)
            if (msg._tag === 'LSD.MessagePortForStoreRes') {
              yield* Deferred.succeed(storeMessagePortDeferred, msg.port)
            } else {
              yield* PubSub.publish(incomingMessagesPubSub, msg)
            }
          }),
        ),
        Stream.runDrain,
        Effect.withSpan(`@livestore/web:worker:devtools:onPortMessage`),
        Effect.ignoreLogged,
        Effect.forkScoped,
      )

      yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeaderTab }), { force: true })

      yield* sendMessage(Devtools.MessagePortForStoreReq.make({ appHostId, liveStoreVersion, requestId: cuid() }), {
        force: true,
      })

      yield* listenToDevtools({
        incomingMessages,
        sendMessage,
        isConnected,
        disconnect,
        storeId,
        appHostId,
        isLeaderTab,
        persistenceInfo,
      })
    }).pipe(Effect.withSpan('@livestore/web:worker:devtools:connect', { attributes: { appHostId } }))

  const broadcast: DevtoolsContextEnabled['broadcast'] = (message) =>
    Effect.gen(function* () {
      for (const callback of broadcastCallbacks) {
        yield* callback(message)
      }
    })

  return { enabled: true, connect, broadcast, connections } satisfies DevtoolsContextEnabled
})

const listenToDevtools = ({
  incomingMessages,
  sendMessage,
  isConnected,
  disconnect,
  appHostId,
  storeId,
  isLeaderTab,
  persistenceInfo,
}: {
  incomingMessages: Stream.Stream<Devtools.MessageToAppHostCoordinator>
  sendMessage: SendMessage
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  disconnect: Effect.Effect<void>
  appHostId: string
  storeId: string
  isLeaderTab: boolean
  persistenceInfo: PersistenceInfoPair
}) =>
  Effect.gen(function* () {
    const innerWorkerCtx = yield* InnerWorkerCtx
    const { syncBackend, sqlite3, db, dbLog, schema, shutdownStateSubRef } = innerWorkerCtx

    const applyMutation = makeApplyMutation(innerWorkerCtx, () => new Date().toISOString(), db.dbRef.current.pointer)

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    type RequestId = string
    const subscriptionFiberMap = yield* FiberMap.make<RequestId>()

    yield* incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('[@livestore/web:worker:devtools] incomingMessage', decodedEvent)

          if (decodedEvent._tag === 'LSD.DevtoolsReady') {
            if ((yield* isConnected.get) === false) {
              yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeaderTab }), {
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

            yield* SubscriptionRef.set(isConnected, true)
            return
          }

          if (decodedEvent.appHostId !== appHostId) return

          if (decodedEvent._tag === 'LSD.Disconnect') {
            yield* SubscriptionRef.set(isConnected, false)

            yield* disconnect

            // TODO is there a better place for this?
            yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeaderTab }), {
              force: true,
            })

            return
          }

          const { requestId } = decodedEvent
          const reqPayload = { requestId, appHostId, liveStoreVersion }

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* sendMessage(Devtools.Pong.make({ ...reqPayload }))
              return
            }
            case 'LSD.SnapshotReq': {
              const data = yield* db.export

              yield* sendMessage(Devtools.SnapshotRes.make({ snapshot: data, ...reqPayload }))

              return
            }
            case 'LSD.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpDb = WaSqlite.makeInMemoryDb(sqlite3)

                WaSqlite.importBytesToDb(sqlite3, tmpDb, data)

                const tmpSyncDb = makeSynchronousDatabase(sqlite3, tmpDb)
                const tableNameResults = tmpSyncDb.select<{ name: string }>(
                  `select name from sqlite_master where type = 'table'`,
                )

                tableNames = new Set(tableNameResults.map((_) => _.name))

                sqlite3.close(tmpDb)
              } catch (e) {
                yield* Effect.logError(`Error importing database file`, e)
                yield* sendMessage(Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-file' }))

                return
              }

              if (tableNames.has(MUTATION_LOG_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                yield* dbLog.import(data)

                yield* db.destroy
              } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_MUTATIONS_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                yield* db.import(data)

                yield* dbLog.destroy
              } else {
                yield* sendMessage(Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-database' }))
                return
              }

              yield* sendMessage(Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'ok' }))

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-import' }))

              return
            }
            case 'LSD.ResetAllDataReq': {
              const { mode } = decodedEvent

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

              yield* db.destroy

              if (mode === 'all-data') {
                yield* dbLog.destroy
              }

              yield* sendMessage(Devtools.ResetAllDataRes.make({ ...reqPayload }))

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-reset' }))

              return
            }
            case 'LSD.DatabaseFileInfoReq': {
              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`

              const dbFileSize = db.dbRef.current.syncDb.select<{ size: number }>(dbSizeQuery, undefined)[0]!.size

              const mutationLogFileSize = dbLog.dbRef.current.syncDb.select<{ size: number }>(
                dbSizeQuery,
                undefined,
              )[0]!.size

              yield* sendMessage(
                Devtools.DatabaseFileInfoRes.make({
                  db: { fileSize: dbFileSize, persistenceInfo: persistenceInfo.db },
                  mutationLog: { fileSize: mutationLogFileSize, persistenceInfo: persistenceInfo.mutationLog },
                  ...reqPayload,
                }),
              )

              return
            }
            case 'LSD.MutationLogReq': {
              const mutationLog = yield* dbLog.export

              yield* sendMessage(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

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
                inTransaction: false,
                syncMetadataJson: Option.none(),
              })

              yield* sendMessage(Devtools.RunMutationRes.make({ ...reqPayload }))

              return
            }
            case 'LSD.SyncingInfoReq': {
              const syncingInfo = Devtools.SyncingInfo.make({
                enabled: syncBackend !== undefined,
                metadata: {},
              })

              yield* sendMessage(Devtools.SyncingInfoRes.make({ syncingInfo, ...reqPayload }))

              return
            }
            case 'LSD.NetworkStatusSubscribe': {
              if (syncBackend !== undefined) {
                const { requestId } = decodedEvent

                // TODO investigate and fix bug. seems that when sending messages right after
                // the devtools have connected get sometimes lost
                // This is probably the same "flaky databrowser loading" bug as we're seeing in the playwright tests
                yield* Effect.sleep(1000)

                yield* syncBackend.isConnected.changes.pipe(
                  Stream.tap((isConnected) =>
                    sendMessage(
                      Devtools.NetworkStatusRes.make({
                        networkStatus: { isConnected, timestampMs: Date.now() },
                        ...reqPayload,
                      }),
                    ),
                  ),
                  Stream.runDrain,
                  Effect.interruptible,
                  Effect.tapCauseLogPretty,
                  FiberMap.run(subscriptionFiberMap, requestId),
                )
              }

              return
            }
            case 'LSD.NetworkStatusUnsubscribe': {
              const { requestId } = decodedEvent

              yield* FiberMap.remove(subscriptionFiberMap, requestId)

              return
            }
          }
        }).pipe(Effect.withSpan(`@livestore/web:worker:onDevtoolsMessage:${decodedEvent._tag}`)),
      ),
      UnexpectedError.mapToUnexpectedErrorStream,
      Stream.runDrain,
    )
  })
