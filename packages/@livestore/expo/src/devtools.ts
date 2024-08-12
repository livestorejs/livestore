import type { ConnectDevtoolsToStore, Coordinator } from '@livestore/common'
import {
  Devtools,
  liveStoreVersion,
  MUTATION_LOG_META_TABLE,
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { makeExpoDevtoolsChannel } from '@livestore/devtools-expo-bridge/web-channel'
import { Cause, Effect, Queue, Schema, Stream, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite/next'

import type { DbPairRef } from './common.js'
import { makeSynchronousDatabase, overwriteDbFile } from './common.js'

export const bootDevtools = ({
  connectDevtoolsToStore,
  coordinator,
  // schema,
  shutdown,
  dbRef,
  dbLogRef,
}: {
  connectDevtoolsToStore: ConnectDevtoolsToStore
  coordinator: Coordinator
  schema: LiveStoreSchema
  dbRef: DbPairRef
  dbLogRef: DbPairRef
  shutdown: (cause: Cause.Cause<any>) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const expoDevtoolsChannel = yield* makeExpoDevtoolsChannel({
      sendSchema: Schema.Union(Devtools.MessageFromAppHostCoordinator, Devtools.MessageFromAppHostStore),
      listenSchema: Schema.Union(Devtools.MessageToAppHostCoordinator, Devtools.MessageToAppHostStore),
    })

    const isConnected = yield* SubscriptionRef.make(false)

    const storeDevtoolsChannelProxy = yield* WebChannel.queueChannelProxy<
      Devtools.MessageToAppHostStore,
      Devtools.MessageFromAppHostStore
    >()

    yield* storeDevtoolsChannelProxy.sendQueue.pipe(
      Stream.fromQueue,
      Stream.tap((msg) => expoDevtoolsChannel.send(msg)),
      Stream.runDrain,
      Effect.forkScoped,
    )

    yield* expoDevtoolsChannel.listen.pipe(
      Stream.flatten(),
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          if (Schema.is(Devtools.MessageToAppHostStore)(decodedEvent)) {
            yield* storeDevtoolsChannelProxy.listenQueue.pipe(Queue.offer(decodedEvent))
            return
          }

          if (decodedEvent._tag === 'LSD.DevtoolsReady') {
            if ((yield* isConnected.get) === false) {
              yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ channelId, liveStoreVersion, isLeaderTab }))
            }

            return
          }

          if (decodedEvent._tag === 'LSD.DevtoolsConnected') {
            if (yield* isConnected.get) {
              console.warn('devtools already connected')
              return
            }

            yield* connectDevtoolsToStore(storeDevtoolsChannelProxy.webChannel).pipe(
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            )

            yield* SubscriptionRef.set(isConnected, true)
            return
          }

          if (decodedEvent._tag === 'LSD.Disconnect') {
            yield* SubscriptionRef.set(isConnected, false)

            // yield* disconnect

            // TODO is there a better place for this?
            yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ channelId, liveStoreVersion, isLeaderTab }))

            return
          }

          const { requestId } = decodedEvent
          const reqPayload = { requestId, channelId, liveStoreVersion }

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* expoDevtoolsChannel.send(Devtools.Pong.make({ ...reqPayload }))
              return
            }
            case 'LSD.SnapshotReq': {
              const data = yield* coordinator.export

              yield* expoDevtoolsChannel.send(Devtools.SnapshotRes.make({ snapshot: data!, ...reqPayload }))

              return
            }
            case 'LSD.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpDb = SQLite.deserializeDatabaseSync(data)

                const tmpInMemoryDb = makeSynchronousDatabase(tmpDb)
                const tableNameResults = tmpInMemoryDb
                  .prepare(`select name from sqlite_master where type = 'table'`)
                  .select<{ name: string }>(undefined)

                tableNames = new Set(tableNameResults.map((_) => _.name))

                tmpDb.closeSync()
              } catch (e) {
                yield* expoDevtoolsChannel.send(
                  Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-file' }),
                )

                return
              }

              if (tableNames.has(MUTATION_LOG_META_TABLE)) {
                // yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                dbLogRef.current!.db.closeSync()

                yield* overwriteDbFile(dbLogRef.current!.db.databaseName, data)

                dbLogRef.current = undefined

                dbRef.current!.db.closeSync()
                SQLite.deleteDatabaseSync(dbRef.current!.db.databaseName)
              } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_MUTATIONS_META_TABLE)) {
                // yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                // yield* db.import(data)

                dbRef.current!.db.closeSync()

                yield* overwriteDbFile(dbRef.current!.db.databaseName, data)
              } else {
                yield* expoDevtoolsChannel.send(
                  Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-database' }),
                )
                return
              }

              yield* expoDevtoolsChannel.send(Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'ok' }))

              yield* shutdown(Cause.fail(UnexpectedError.make({ cause: 'Shutdown' })))

              return
            }
            case 'LSD.ResetAllDataReq': {
              const { mode } = decodedEvent

              dbRef.current!.db.closeSync()
              SQLite.deleteDatabaseSync(dbRef.current!.db.databaseName)

              if (mode === 'all-data') {
                dbLogRef.current!.db.closeSync()
                SQLite.deleteDatabaseSync(dbLogRef.current!.db.databaseName)
              }

              yield* expoDevtoolsChannel.send(Devtools.ResetAllDataRes.make({ ...reqPayload }))

              yield* shutdown(Cause.fail(UnexpectedError.make({ cause: 'Shutdown' })))

              return
            }
            case 'LSD.DatabaseFileInfoReq': {
              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`
              const dbFileSize = dbRef.current!.db.prepareSync(dbSizeQuery).executeSync<any>().getFirstSync()!
                .size as number
              const mutationLogFileSize = dbLogRef
                .current!.db.prepareSync(dbSizeQuery)
                .executeSync<any>()
                .getFirstSync()!.size as number

              yield* expoDevtoolsChannel.send(
                Devtools.DatabaseFileInfoRes.make({ dbFileSize, mutationLogFileSize, ...reqPayload }),
              )

              return
            }
            case 'LSD.MutationLogReq': {
              const mutationLog = yield* coordinator.getMutationLogData

              yield* expoDevtoolsChannel.send(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

              return
            }
            case 'LSD.RunMutationReq': {
              console.log('run mutation req', decodedEvent)
              const { mutationEventEncoded, persisted } = decodedEvent

              // const mutationDef =
              //   schema.mutations.get(mutationEventEncoded.mutation) ??
              //   shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

              yield* coordinator.mutate(mutationEventEncoded, { persisted })

              yield* expoDevtoolsChannel.send(Devtools.RunMutationRes.make({ ...reqPayload }))

              return
            }
            case 'LSD.SyncingInfoReq': {
              const syncingInfo = Devtools.SyncingInfo.make({
                enabled: false,
                metadata: {},
              })

              yield* expoDevtoolsChannel.send(Devtools.SyncingInfoRes.make({ syncingInfo, ...reqPayload }))

              return
            }
          }
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const channelId = 'expo'
    const isLeaderTab = true
    yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ channelId, isLeaderTab, liveStoreVersion }))

    const onMutation = ({
      mutationEventEncoded,
      persisted,
    }: {
      mutationEventEncoded: MutationEvent.Any
      persisted: boolean
    }) =>
      expoDevtoolsChannel
        .send(Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted, liveStoreVersion }))
        .pipe(UnexpectedError.mapToUnexpectedError)

    return {
      onMutation,
    }
  }).pipe(Effect.withSpan('@livestore/expo:bootDevtools'))
