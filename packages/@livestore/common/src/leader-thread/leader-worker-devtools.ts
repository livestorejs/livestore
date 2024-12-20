import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FiberMap, FiberSet, Option, PubSub, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { Devtools, IntentionalShutdownCause, liveStoreVersion, UnexpectedError } from '../index.js'
import { MUTATION_LOG_META_TABLE, SCHEMA_META_TABLE, SCHEMA_MUTATIONS_META_TABLE } from '../schema/index.js'
import { makeApplyMutation } from './apply-mutation.js'
import type { ShutdownChannel } from './shutdown-channel.js'
import type { DevtoolsContextEnabled, PersistenceInfoPair } from './types.js'
import { LeaderThreadCtx } from './types.js'

type SendMessageToDevtools = (
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
    coordinatorMessagePortOrChannel,
    disconnect,
    // storeMessagePortDeferred,
    storeId,
    appHostId,
    isLeader,
    persistenceInfo,
    shutdownChannel,
  }) =>
    Effect.gen(function* () {
      // const isConnected = yield* SubscriptionRef.make(false)
      const isConnected = yield* SubscriptionRef.make(true)

      const incomingMessagesPubSub = yield* PubSub.unbounded<Devtools.MessageToAppHostCoordinator>().pipe(
        Effect.acquireRelease(PubSub.shutdown),
      )

      const incomingMessages = Stream.fromPubSub(incomingMessagesPubSub)

      const outgoingMessagesQueue = yield* Queue.unbounded<Devtools.MessageFromAppHostCoordinator>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const devtoolsCoordinatorChannel = coordinatorMessagePortOrChannel
      // coordinatorMessagePortOrChannel instanceof MessagePort
      //   ? yield* WebChannel.messagePortChannel({
      //       port: coordinatorMessagePortOrChannel,
      //       schema: { send: Devtools.MessageFromAppHostCoordinator, listen: Devtools.MessageToAppHostCoordinator },
      //     })
      //   : coordinatorMessagePortOrChannel

      const sendMessage: SendMessageToDevtools = (message, options) =>
        Effect.gen(function* () {
          if (options?.force === true || (yield* isConnected)) {
            yield* devtoolsCoordinatorChannel.send(message)
          } else {
            yield* Queue.offer(outgoingMessagesQueue, message)
          }
        }).pipe(
          Effect.withSpan('@livestore/web:worker:devtools:sendToDevtools'),
          Effect.interruptible,
          Effect.ignoreLogged,
        )

      broadcastCallbacks.add((message) => sendMessage(message))

      yield* devtoolsCoordinatorChannel.listen.pipe(
        Stream.flatten(),
        // Stream.tapLogWithLabel('@livestore/web:worker:devtools:onPortMessage'),
        Stream.tap((msg) =>
          Effect.gen(function* () {
            // yield* Effect.logDebug(`[@livestore/web:worker:devtools] message from port: ${msg._tag}`, msg)
            // if (msg._tag === 'LSD.MessagePortForStoreRes') {
            //   yield* Deferred.succeed(storeMessagePortDeferred, msg.port)
            // } else {
            yield* PubSub.publish(incomingMessagesPubSub, msg)
            // }
          }),
        ),
        Stream.runDrain,
        Effect.withSpan(`@livestore/web:worker:devtools:onPortMessage`),
        Effect.ignoreLogged,
        Effect.forkScoped,
      )

      // yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }), { force: true })

      // yield* sendMessage(Devtools.MessagePortForStoreReq.make({ appHostId, liveStoreVersion, requestId: nanoid() }), {
      //   force: true,
      // })

      yield* listenToDevtools({
        incomingMessages,
        sendMessage,
        isConnected,
        disconnect,
        storeId,
        appHostId,
        isLeader,
        persistenceInfo,
        shutdownChannel,
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
  isLeader,
  persistenceInfo,
  shutdownChannel,
}: {
  incomingMessages: Stream.Stream<Devtools.MessageToAppHostCoordinator>
  sendMessage: SendMessageToDevtools
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  disconnect: Effect.Effect<void>
  appHostId: string
  storeId: string
  isLeader: boolean
  persistenceInfo: PersistenceInfoPair
  shutdownChannel: ShutdownChannel
}) =>
  Effect.gen(function* () {
    const innerWorkerCtx = yield* LeaderThreadCtx
    const { syncBackend, makeSyncDb, db, dbLog, schema, shutdownStateSubRef, nextMutationEventIdPair } = innerWorkerCtx

    const applyMutation = yield* makeApplyMutation(() => new Date().toISOString(), db)

    type RequestId = string
    const subscriptionFiberMap = yield* FiberMap.make<RequestId>()

    yield* incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('[@livestore/web:worker:devtools] incomingMessage', decodedEvent)

          if (decodedEvent._tag === 'LSD.DevtoolsReady') {
            // if ((yield* isConnected) === false) {
            //   yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }), {
            //     force: true,
            //   })
            // }
            return
          }

          if (decodedEvent._tag === 'LSD.DevtoolsConnected') {
            // if (yield* isConnected) {
            //   console.warn('devtools already connected')
            //   return
            // }

            // yield* SubscriptionRef.set(isConnected, true)
            return
          }

          if (decodedEvent.appHostId !== appHostId) return

          if (decodedEvent._tag === 'LSD.Disconnect') {
            // yield* SubscriptionRef.set(isConnected, false)

            // yield* disconnect

            // TODO is there a better place for this?
            // yield* sendMessage(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }), {
            //   force: true,
            // })

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
              const snapshot = db.export()

              yield* sendMessage(Devtools.SnapshotRes.make({ snapshot, ...reqPayload }))

              return
            }
            case 'LSD.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpSyncDb = yield* makeSyncDb({ _tag: 'in-memory' })
                tmpSyncDb.import(data)
                const tableNameResults = tmpSyncDb.select<{ name: string }>(
                  `select name from sqlite_master where type = 'table'`,
                )

                tableNames = new Set(tableNameResults.map((_) => _.name))

                tmpSyncDb.close()
              } catch (e) {
                yield* Effect.logError(`Error importing database file`, e)
                yield* sendMessage(Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-file' }))

                return
              }

              if (tableNames.has(MUTATION_LOG_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                dbLog.import(data)

                db.destroy()
              } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_MUTATIONS_META_TABLE)) {
                yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                db.import(data)

                dbLog.destroy()
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

              db.destroy()

              if (mode === 'all-data') {
                dbLog.destroy()
              }

              yield* sendMessage(Devtools.ResetAllDataRes.make({ ...reqPayload }))

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-reset' }))

              return
            }
            case 'LSD.DatabaseFileInfoReq': {
              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`
              const dbFileSize = db.select<{ size: number }>(dbSizeQuery, undefined)[0]!.size
              const mutationLogFileSize = dbLog.select<{ size: number }>(dbSizeQuery, undefined)[0]!.size

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
              const mutationLog = dbLog.export()

              yield* sendMessage(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

              return
            }
            case 'LSD.RunMutationReq': {
              const { mutationEventEncoded: mutationEventEncoded_, persisted } = decodedEvent

              const mutationDef =
                schema.mutations.get(mutationEventEncoded_.mutation) ??
                shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded_.mutation}`)

              const mutationEventEncoded = {
                ...mutationEventEncoded_,
                ...nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly }),
              }

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
            case 'LSD.SyncHistorySubscribe': {
              const { requestId } = decodedEvent

              if (syncBackend !== undefined) {
                yield* syncBackend.pull(Option.none(), { listenForNew: true }).pipe(
                  Stream.tap(({ mutationEventEncoded, metadata }) =>
                    sendMessage(Devtools.SyncHistoryRes.make({ mutationEventEncoded, metadata, ...reqPayload })),
                  ),
                  Stream.runDrain,
                  Effect.acquireRelease(() => Effect.log('syncHistorySubscribe done')),
                  Effect.interruptible,
                  Effect.tapCauseLogPretty,
                  FiberMap.run(subscriptionFiberMap, requestId),
                )
              }

              return
            }
            case 'LSD.SyncHistoryUnsubscribe': {
              const { requestId } = decodedEvent
              console.log('LSD.SyncHistoryUnsubscribe', requestId)

              yield* FiberMap.remove(subscriptionFiberMap, requestId)

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
