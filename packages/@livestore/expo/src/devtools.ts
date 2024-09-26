import type { ConnectDevtoolsToStore, Coordinator } from '@livestore/common'
import {
  Devtools,
  IntentionalShutdownCause,
  liveStoreVersion,
  MUTATION_LOG_META_TABLE,
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { makeExpoDevtoolsChannel } from '@livestore/devtools-expo-common/web-channel'
import { Cause, Effect, Queue, Schema, Stream, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite/next'

import type { DbPairRef } from './common.js'
import { makeSynchronousDatabase, overwriteDbFile } from './common.js'

export const bootDevtools = ({
  connectDevtoolsToStore,
  coordinator,
  schema,
  shutdown,
  dbRef,
  dbLogRef,
  incomingSyncMutationsQueue,
}: {
  connectDevtoolsToStore: ConnectDevtoolsToStore
  coordinator: Coordinator
  schema: LiveStoreSchema
  dbRef: DbPairRef
  dbLogRef: DbPairRef
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => Effect.Effect<void>
  incomingSyncMutationsQueue: Queue.Queue<MutationEvent.Any>
}) =>
  Effect.gen(function* () {
    const appHostId = 'expo'
    const isLeader = true

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

    const mutationEventSchema = makeMutationEventSchema(schema)

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
              yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }))
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
            yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }))

            return
          }

          const { requestId } = decodedEvent
          const reqPayload = { requestId, appHostId, liveStoreVersion }

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
                const tmpSyncDb = makeSynchronousDatabase(tmpDb)
                const tableNameResults = tmpSyncDb.select<{ name: string }>(
                  `select name from sqlite_master where type = 'table'`,
                )

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

              yield* shutdown(Cause.fail(IntentionalShutdownCause.make({ reason: 'devtools-import' })))

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

              yield* shutdown(Cause.fail(IntentionalShutdownCause.make({ reason: 'devtools-reset' })))

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
                Devtools.DatabaseFileInfoRes.make({
                  db: { fileSize: dbFileSize, persistenceInfo: { fileName: 'livestore.db' } },
                  mutationLog: {
                    fileSize: mutationLogFileSize,
                    persistenceInfo: { fileName: 'livestore-mutationlog.db' },
                  },
                  ...reqPayload,
                }),
              )

              return
            }
            case 'LSD.MutationLogReq': {
              const mutationLog = yield* coordinator.getMutationLogData

              yield* expoDevtoolsChannel.send(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

              return
            }
            case 'LSD.RunMutationReq': {
              const { mutationEventEncoded: mutationEventEncoded_, persisted } = decodedEvent

              const mutationEventEncoded = {
                ...mutationEventEncoded_,
                id: 'TODO',
                parentId: 'TODO',
              }

              const mutationEventDecoded = yield* Schema.decode(mutationEventSchema)(mutationEventEncoded)
              yield* Queue.offer(incomingSyncMutationsQueue, mutationEventDecoded)

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
    yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, isLeader, liveStoreVersion }))

    const onMutation = ({
      mutationEventEncoded,
      persisted,
    }: {
      mutationEventEncoded: MutationEvent.AnyEncoded
      persisted: boolean
    }) =>
      expoDevtoolsChannel
        .send(Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted, liveStoreVersion }))
        .pipe(UnexpectedError.mapToUnexpectedError)

    return {
      onMutation,
    }
  }).pipe(Effect.withSpan('@livestore/expo:bootDevtools'))
