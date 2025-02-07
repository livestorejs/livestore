import { Effect, FiberMap, Option, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { Devtools, IntentionalShutdownCause, liveStoreVersion, UnexpectedError } from '../index.js'
import { MUTATION_LOG_META_TABLE, SCHEMA_META_TABLE, SCHEMA_MUTATIONS_META_TABLE } from '../schema/mod.js'
import type { DevtoolsOptions, PersistenceInfoPair } from './types.js'
import { LeaderThreadCtx } from './types.js'

type SendMessageToDevtools = (message: Devtools.MessageFromAppLeader) => Effect.Effect<void>

// TODO bind scope to the webchannel lifetime
export const bootDevtools = (options: DevtoolsOptions) =>
  Effect.gen(function* () {
    if (options.enabled === false) {
      return
    }

    const { connectedClientSessionPullQueues, syncProcessor, extraIncomingMessagesQueue } = yield* LeaderThreadCtx

    yield* listenToDevtools({
      incomingMessages: Stream.fromQueue(extraIncomingMessagesQueue),
      sendMessage: () => Effect.void,
    }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

    const { persistenceInfo, devtoolsWebChannel } = yield* options.makeBootContext

    const sendMessage: SendMessageToDevtools = (message) =>
      devtoolsWebChannel
        .send(message)
        .pipe(
          Effect.withSpan('@livestore/common:leader-thread:devtools:sendToDevtools'),
          Effect.interruptible,
          Effect.ignoreLogged,
        )

    const { localHead } = yield* syncProcessor.syncState

    // TODO close queue when devtools disconnects
    const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(localHead)

    yield* Stream.fromQueue(pullQueue).pipe(
      Stream.tap((msg) =>
        Effect.gen(function* () {
          if (msg.payload._tag === 'upstream-advance') {
            for (const mutationEventEncoded of msg.payload.newEvents) {
              // TODO refactor with push semantics
              yield* sendMessage(Devtools.MutationBroadcast.make({ mutationEventEncoded, liveStoreVersion }))
            }
          } else {
            yield* Effect.logWarning('TODO implement rebases in devtools')
          }
        }),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    )

    yield* listenToDevtools({
      incomingMessages: devtoolsWebChannel.listen.pipe(Stream.flatten(), Stream.orDie),
      sendMessage,
      persistenceInfo,
    }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:devtools:boot'))

const listenToDevtools = ({
  incomingMessages,
  sendMessage,
  persistenceInfo,
}: {
  incomingMessages: Stream.Stream<Devtools.MessageToAppLeader>
  sendMessage: SendMessageToDevtools
  persistenceInfo?: PersistenceInfoPair
}) =>
  Effect.gen(function* () {
    const { syncBackend, makeSqliteDb, db, dbLog, shutdownStateSubRef, shutdownChannel, syncProcessor } =
      yield* LeaderThreadCtx

    type RequestId = string
    const subscriptionFiberMap = yield* FiberMap.make<RequestId>()

    yield* incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug('[@livestore/common:leader-thread:devtools] incomingMessage', decodedEvent)

          if (decodedEvent._tag === 'LSD.Disconnect') {
            return
          }

          const { requestId } = decodedEvent
          const reqPayload = { requestId, liveStoreVersion }

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* sendMessage(Devtools.Pong.make({ ...reqPayload }))
              return
            }
            case 'LSD.Leader.SnapshotReq': {
              const snapshot = db.export()

              yield* sendMessage(Devtools.SnapshotRes.make({ snapshot, ...reqPayload }))

              return
            }
            case 'LSD.Leader.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpDb = yield* makeSqliteDb({ _tag: 'in-memory' })
                tmpDb.import(data)
                const tableNameResults = tmpDb.select<{ name: string }>(
                  `select name from sqlite_master where type = 'table'`,
                )

                tableNames = new Set(tableNameResults.map((_) => _.name))

                tmpDb.close()
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

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-import' })) ?? Effect.void

              return
            }
            case 'LSD.Leader.ResetAllDataReq': {
              const { mode } = decodedEvent

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

              db.destroy()

              if (mode === 'all-data') {
                dbLog.destroy()
              }

              yield* sendMessage(Devtools.ResetAllDataRes.make({ ...reqPayload }))

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-reset' })) ?? Effect.void

              return
            }
            case 'LSD.Leader.DatabaseFileInfoReq': {
              if (persistenceInfo === undefined) {
                console.log('[@livestore/common:leader-thread:devtools] persistenceInfo is required for this request')
                return
              }

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
            case 'LSD.Leader.MutationLogReq': {
              const mutationLog = dbLog.export()

              yield* sendMessage(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

              return
            }
            case 'LSD.Leader.RunMutationReq': {
              yield* syncProcessor.pushPartial(decodedEvent.mutationEventEncoded)

              yield* sendMessage(Devtools.RunMutationRes.make({ ...reqPayload }))

              return
            }
            case 'LSD.Leader.SyncHistorySubscribe': {
              const { requestId } = decodedEvent

              if (syncBackend !== undefined) {
                // TODO consider piggybacking on the existing leader-thread sync-pulling
                yield* syncBackend.pull(Option.none()).pipe(
                  Stream.map((_) => _.batch),
                  Stream.flattenIterables,
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
            case 'LSD.Leader.SyncHistoryUnsubscribe': {
              const { requestId } = decodedEvent
              console.log('LSD.SyncHistoryUnsubscribe', requestId)

              yield* FiberMap.remove(subscriptionFiberMap, requestId)

              return
            }
            case 'LSD.Leader.SyncingInfoReq': {
              const syncingInfo = Devtools.SyncingInfo.make({
                enabled: syncBackend !== undefined,
                metadata: {},
              })

              yield* sendMessage(Devtools.SyncingInfoRes.make({ syncingInfo, ...reqPayload }))

              return
            }
            case 'LSD.Leader.NetworkStatusSubscribe': {
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
            case 'LSD.Leader.NetworkStatusUnsubscribe': {
              const { requestId } = decodedEvent

              yield* FiberMap.remove(subscriptionFiberMap, requestId)

              return
            }
          }
        }).pipe(Effect.withSpan(`@livestore/common:leader-thread:onDevtoolsMessage:${decodedEvent._tag}`)),
      ),
      UnexpectedError.mapToUnexpectedErrorStream,
      Stream.runDrain,
    )
  })
