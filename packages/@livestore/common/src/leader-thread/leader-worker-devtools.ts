import { Effect, FiberMap, Option, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { Devtools, IntentionalShutdownCause, liveStoreVersion, UnexpectedError } from '../index.js'
import { EVENTLOG_META_TABLE, SCHEMA_EVENT_DEFS_META_TABLE, SCHEMA_META_TABLE } from '../schema/mod.js'
import type { DevtoolsOptions, PersistenceInfoPair } from './types.js'
import { LeaderThreadCtx } from './types.js'

type SendMessageToDevtools = (message: Devtools.Leader.MessageFromApp) => Effect.Effect<void>

// TODO bind scope to the webchannel lifetime
export const bootDevtools = (options: DevtoolsOptions) =>
  Effect.gen(function* () {
    if (options.enabled === false) {
      return
    }

    const { syncProcessor, extraIncomingMessagesQueue } = yield* LeaderThreadCtx

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

    const syncState = yield* syncProcessor.syncState
    const mergeCounter = syncProcessor.getMergeCounter()

    yield* syncProcessor.pull({ cursor: { mergeCounter, eventId: syncState.localHead } }).pipe(
      Stream.tap(({ payload }) => sendMessage(Devtools.Leader.SyncPull.make({ payload, liveStoreVersion }))),
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
  incomingMessages: Stream.Stream<Devtools.Leader.MessageToApp>
  sendMessage: SendMessageToDevtools
  persistenceInfo?: PersistenceInfoPair
}) =>
  Effect.gen(function* () {
    const {
      syncBackend,
      makeSqliteDb,
      dbReadModel,
      dbEventlog,
      shutdownStateSubRef,
      shutdownChannel,
      syncProcessor,
      clientId,
      devtools,
    } = yield* LeaderThreadCtx

    type SubscriptionId = string
    const subscriptionFiberMap = yield* FiberMap.make<SubscriptionId>()

    type RequestId = string
    const handledRequestIds = new Set<RequestId>()

    yield* incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          const { requestId } = decodedEvent
          const reqPayload = { requestId, liveStoreVersion, clientId }

          // yield* Effect.logDebug(
          //   `[@livestore/common:leader-thread:devtools] incomingMessage: ${decodedEvent._tag} (${requestId})`,
          //   decodedEvent,
          // )

          if (decodedEvent._tag === 'LSD.Leader.Disconnect') {
            return
          }

          // TODO we should try to move the duplicate message handling on the webmesh layer
          // So far I could only observe this problem with webmesh proxy channels (e.g. for Expo)
          // Proof: https://share.cleanshot.com/V9G87B0B
          // Also see `store/devtools.ts` for same problem
          if (handledRequestIds.has(requestId)) {
            // yield* Effect.logWarning(`Duplicate message`, decodedEvent)
            return
          }

          handledRequestIds.add(requestId)

          switch (decodedEvent._tag) {
            case 'LSD.Leader.Ping': {
              yield* sendMessage(Devtools.Leader.Pong.make({ ...reqPayload }))
              return
            }
            case 'LSD.Leader.SnapshotReq': {
              const snapshot = dbReadModel.export()

              yield* sendMessage(Devtools.Leader.SnapshotRes.make({ snapshot, ...reqPayload }))

              return
            }
            case 'LSD.Leader.LoadDatabaseFile.Request': {
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
              } catch (cause) {
                yield* Effect.logError(`Error importing database file`, cause)
                yield* sendMessage(
                  Devtools.Leader.LoadDatabaseFile.Error.make({
                    ...reqPayload,
                    cause: { _tag: 'unexpected-error', cause },
                  }),
                )

                return
              }

              try {
                if (tableNames.has(EVENTLOG_META_TABLE)) {
                  // Is eventlog
                  yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                  dbEventlog.import(data)

                  dbReadModel.destroy()
                } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_EVENT_DEFS_META_TABLE)) {
                  // Is read model
                  yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                  dbReadModel.import(data)

                  dbEventlog.destroy()
                } else {
                  yield* sendMessage(
                    Devtools.Leader.LoadDatabaseFile.Error.make({
                      ...reqPayload,
                      cause: { _tag: 'unsupported-database' },
                    }),
                  )
                  return
                }

                yield* sendMessage(Devtools.Leader.LoadDatabaseFile.Success.make({ ...reqPayload }))
                yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-import' })) ?? Effect.void

                return
              } catch (cause) {
                yield* Effect.logError(`Error importing database file`, cause)
                yield* sendMessage(
                  Devtools.Leader.LoadDatabaseFile.Error.make({
                    ...reqPayload,
                    cause: { _tag: 'unexpected-error', cause },
                  }),
                )
                return
              }
            }
            case 'LSD.Leader.ResetAllData.Request': {
              const { mode } = decodedEvent

              yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

              dbReadModel.destroy()

              if (mode === 'all-data') {
                dbEventlog.destroy()
              }

              yield* sendMessage(Devtools.Leader.ResetAllData.Success.make({ ...reqPayload }))

              yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'devtools-reset' })) ?? Effect.void

              return
            }
            case 'LSD.Leader.DatabaseFileInfoReq': {
              if (persistenceInfo === undefined) {
                console.log('[@livestore/common:leader-thread:devtools] persistenceInfo is required for this request')
                return
              }

              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`
              const dbFileSize = dbReadModel.select<{ size: number }>(dbSizeQuery, undefined)[0]!.size
              const eventlogFileSize = dbEventlog.select<{ size: number }>(dbSizeQuery, undefined)[0]!.size

              yield* sendMessage(
                Devtools.Leader.DatabaseFileInfoRes.make({
                  readModel: { fileSize: dbFileSize, persistenceInfo: persistenceInfo.readModel },
                  eventlog: { fileSize: eventlogFileSize, persistenceInfo: persistenceInfo.eventlog },
                  ...reqPayload,
                }),
              )

              return
            }
            case 'LSD.Leader.EventlogReq': {
              const eventlog = dbEventlog.export()

              yield* sendMessage(Devtools.Leader.EventlogRes.make({ eventlog, ...reqPayload }))

              return
            }
            case 'LSD.Leader.CommitEventReq': {
              yield* syncProcessor.pushPartial({
                event: decodedEvent.eventEncoded,
                clientId: `devtools-${clientId}`,
                sessionId: `devtools-${clientId}`,
              })

              yield* sendMessage(Devtools.Leader.CommitEventRes.make({ ...reqPayload }))

              return
            }
            case 'LSD.Leader.SyncHistorySubscribe': {
              const { subscriptionId } = decodedEvent

              if (syncBackend !== undefined) {
                // TODO consider piggybacking on the existing leader-thread sync-pulling
                yield* syncBackend.pull(Option.none()).pipe(
                  Stream.map((_) => _.batch),
                  Stream.flattenIterables,
                  Stream.tap(({ eventEncoded, metadata }) =>
                    sendMessage(
                      Devtools.Leader.SyncHistoryRes.make({
                        eventEncoded,
                        metadata,
                        subscriptionId,
                        ...reqPayload,
                        requestId: nanoid(10),
                      }),
                    ),
                  ),
                  Stream.runDrain,
                  Effect.interruptible,
                  Effect.tapCauseLogPretty,
                  FiberMap.run(subscriptionFiberMap, subscriptionId),
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
              const syncingInfo = Devtools.Leader.SyncingInfo.make({
                enabled: syncBackend !== undefined,
                metadata: syncBackend?.metadata ?? {},
              })

              yield* sendMessage(Devtools.Leader.SyncingInfoRes.make({ syncingInfo, ...reqPayload }))

              return
            }
            case 'LSD.Leader.NetworkStatusSubscribe': {
              if (syncBackend !== undefined) {
                const { subscriptionId } = decodedEvent

                // TODO investigate and fix bug. seems that when sending messages right after
                // the devtools have connected get sometimes lost
                // This is probably the same "flaky databrowser loading" bug as we're seeing in the playwright tests
                yield* Effect.sleep(1000)

                yield* Stream.zipLatest(
                  syncBackend.isConnected.changes,
                  devtools.enabled ? devtools.syncBackendLatchState.changes : Stream.make({ latchClosed: false }),
                ).pipe(
                  Stream.tap(([isConnected, { latchClosed }]) =>
                    sendMessage(
                      Devtools.Leader.NetworkStatusRes.make({
                        networkStatus: { isConnected, timestampMs: Date.now(), latchClosed },
                        subscriptionId,
                        ...reqPayload,
                        requestId: nanoid(10),
                      }),
                    ),
                  ),
                  Stream.runDrain,
                  Effect.interruptible,
                  Effect.tapCauseLogPretty,
                  FiberMap.run(subscriptionFiberMap, subscriptionId),
                )
              }

              return
            }
            case 'LSD.Leader.NetworkStatusUnsubscribe': {
              const { requestId } = decodedEvent

              yield* FiberMap.remove(subscriptionFiberMap, requestId)

              return
            }
            case 'LSD.Leader.SyncHeadSubscribe': {
              const { subscriptionId } = decodedEvent

              yield* syncProcessor.syncState.changes.pipe(
                Stream.tap((syncState) =>
                  sendMessage(
                    Devtools.Leader.SyncHeadRes.make({
                      local: syncState.localHead,
                      upstream: syncState.upstreamHead,
                      subscriptionId,
                      ...reqPayload,
                      requestId: nanoid(10),
                    }),
                  ),
                ),
                Stream.runDrain,
                Effect.interruptible,
                Effect.tapCauseLogPretty,
                FiberMap.run(subscriptionFiberMap, subscriptionId),
              )

              return
            }
            case 'LSD.Leader.SyncHeadUnsubscribe': {
              const { subscriptionId } = decodedEvent

              yield* FiberMap.remove(subscriptionFiberMap, subscriptionId)

              return
            }
            case 'LSD.Leader.SetSyncLatch.Request': {
              const { closeLatch } = decodedEvent

              if (devtools.enabled === false) return

              if (closeLatch === true) {
                yield* devtools.syncBackendLatch.close
              } else {
                yield* devtools.syncBackendLatch.open
              }

              yield* SubscriptionRef.set(devtools.syncBackendLatchState, { latchClosed: closeLatch })

              yield* sendMessage(Devtools.Leader.SetSyncLatch.Success.make({ ...reqPayload }))

              return
            }
            default: {
              yield* Effect.logWarning(`TODO implement devtools message`, decodedEvent)
            }
          }
        }).pipe(Effect.withSpan(`@livestore/common:leader-thread:onDevtoolsMessage:${decodedEvent._tag}`)),
      ),
      UnexpectedError.mapToUnexpectedErrorStream,
      Stream.runDrain,
    )
  })
