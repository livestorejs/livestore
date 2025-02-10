// @ts-nocheck
import type { ClientSession, ConnectDevtoolsToStore } from '@livestore/common'
import {
  Devtools,
  IntentionalShutdownCause,
  liveStoreVersion,
  MUTATION_LOG_META_TABLE,
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  UnexpectedError,
} from '@livestore/common'
import type { PullQueueItem } from '@livestore/common/leader-thread'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import { makeExpoDevtoolsChannel } from '@livestore/devtools-expo-common/web-channel'
import type { ParseResult, Scope } from '@livestore/utils/effect'
import { Cause, Effect, Queue, Schema, Stream, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite'

import type { DbPairRef } from './common.js'
import { makeSqliteDb, overwriteDbFile } from './common.js'

export type BootedDevtools = {
  onMutation: ({
    mutationEventEncoded,
  }: {
    mutationEventEncoded: MutationEvent.AnyEncoded
  }) => Effect.Effect<void, UnexpectedError, never>
}

export const bootDevtools = ({
  connectDevtoolsToStore,
  clientSession,
  schema,
  shutdown,
  dbRef,
  dbMutationLogRef,
  incomingSyncMutationsQueue,
}: {
  connectDevtoolsToStore: ConnectDevtoolsToStore
  clientSession: ClientSession
  schema: LiveStoreSchema
  dbRef: DbPairRef
  dbMutationLogRef: DbPairRef
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => Effect.Effect<void>
  incomingSyncMutationsQueue: Queue.Queue<PullQueueItem>
}): Effect.Effect<BootedDevtools, UnexpectedError | ParseResult.ParseError, Scope.Scope> =>
  Effect.gen(function* () {
    const appHostId = 'expo'
    const isLeader = true

    const expoDevtoolsChannel = yield* makeExpoDevtoolsChannel({
      listenSchema: Schema.Union(Devtools.MessageToApp, Devtools.MessageToApp),
      sendSchema: Schema.Union(Devtools.MessageFromApp, Devtools.MessageFromApp),
    })

    const isConnected = yield* SubscriptionRef.make(false)

    /**
     * Used to forward messages from `expoDevtoolsChannel` to a "filtered" `storeDevtoolsChannel`
     * which is expected by the `connectDevtoolsToStore` function.
     */
    const storeDevtoolsChannelProxy = yield* WebChannel.queueChannelProxy({
      schema: { listen: Devtools.MessageToApp, send: Devtools.MessageFromApp },
    })

    yield* storeDevtoolsChannelProxy.sendQueue.pipe(
      Stream.fromQueue,
      Stream.tap((msg) => expoDevtoolsChannel.send(msg)),
      Stream.runDrain,
      Effect.forkScoped,
    )

    const getDatabaseName = (db: DbPairRef) =>
      db.current!.db.databasePath.slice(db.current!.db.databasePath.lastIndexOf('/') + 1)

    yield* expoDevtoolsChannel.listen.pipe(
      Stream.flatten(),
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          if (Schema.is(Devtools.MessageToApp)(decodedEvent)) {
            yield* storeDevtoolsChannelProxy.listenQueue.pipe(Queue.offer(decodedEvent))
            return
          }

          // if (decodedEvent._tag === 'LSD.DevtoolsReady') {
          //   if ((yield* isConnected.get) === false) {
          //     // yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }))
          //   }

          //   return
          // }

          // if (decodedEvent._tag === 'LSD.DevtoolsConnected') {
          //   if (yield* isConnected.get) {
          //     console.warn('devtools already connected')
          //     return
          //   }

          //   yield* connectDevtoolsToStore(storeDevtoolsChannelProxy.webChannel).pipe(
          //     Effect.tapCauseLogPretty,
          //     Effect.forkScoped,
          //   )

          //   yield* SubscriptionRef.set(isConnected, true)
          //   return
          // }

          // if (decodedEvent._tag === 'LSD.Disconnect') {
          //   yield* SubscriptionRef.set(isConnected, false)

          //   // yield* disconnect

          //   // TODO is there a better place for this?
          //   yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, liveStoreVersion, isLeader }))

          //   return
          // }

          const { requestId } = decodedEvent
          const reqPayload = { requestId, appHostId, liveStoreVersion }

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* expoDevtoolsChannel.send(Devtools.Pong.make({ ...reqPayload }))
              return
            }
            case 'LSD.Leader.SnapshotReq': {
              const data = yield* clientSession.leaderThread.export

              yield* expoDevtoolsChannel.send(Devtools.SnapshotRes.make({ snapshot: data!, ...reqPayload }))

              return
            }
            case 'LSD.Leader.LoadDatabaseFileReq': {
              const { data } = decodedEvent

              let tableNames: Set<string>

              try {
                const tmpExpoDb = SQLite.deserializeDatabaseSync(data)
                const tmpDb = makeSqliteDb(tmpExpoDb)
                const tableNameResults = tmpDb.select<{ name: string }>(
                  `select name from sqlite_master where type = 'table'`,
                )

                tableNames = new Set(tableNameResults.map((_) => _.name))

                tmpExpoDb.closeSync()
              } catch (e) {
                yield* expoDevtoolsChannel.send(
                  Devtools.LoadDatabaseFileRes.make({ ...reqPayload, status: 'unsupported-file' }),
                )

                console.error(e)

                return
              }

              if (tableNames.has(MUTATION_LOG_META_TABLE)) {
                // yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                dbMutationLogRef.current!.db.closeSync()

                yield* overwriteDbFile(getDatabaseName(dbMutationLogRef), data)

                dbMutationLogRef.current = undefined

                dbRef.current!.db.closeSync()
                SQLite.deleteDatabaseSync(getDatabaseName(dbRef))
              } else if (tableNames.has(SCHEMA_META_TABLE) && tableNames.has(SCHEMA_MUTATIONS_META_TABLE)) {
                // yield* SubscriptionRef.set(shutdownStateSubRef, 'shutting-down')

                // yield* db.import(data)

                dbRef.current!.db.closeSync()

                yield* overwriteDbFile(getDatabaseName(dbRef), data)
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
            case 'LSD.Leader.ResetAllDataReq': {
              const { mode } = decodedEvent

              dbRef.current!.db.closeSync()
              SQLite.deleteDatabaseSync(getDatabaseName(dbRef))

              if (mode === 'all-data') {
                dbMutationLogRef.current!.db.closeSync()
                SQLite.deleteDatabaseSync(getDatabaseName(dbMutationLogRef))
              }

              yield* expoDevtoolsChannel.send(Devtools.ResetAllDataRes.make({ ...reqPayload }))

              yield* shutdown(Cause.fail(IntentionalShutdownCause.make({ reason: 'devtools-reset' })))

              return
            }
            case 'LSD.Leader.DatabaseFileInfoReq': {
              const dbSizeQuery = `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();`
              const dbFileSize = dbRef.current!.db.prepareSync(dbSizeQuery).executeSync<any>().getFirstSync()!
                .size as number
              const mutationLogFileSize = dbMutationLogRef
                .current!.db.prepareSync(dbSizeQuery)
                .executeSync<any>()
                .getFirstSync()!.size as number

              yield* expoDevtoolsChannel.send(
                Devtools.DatabaseFileInfoRes.make({
                  readModel: { fileSize: dbFileSize, persistenceInfo: { fileName: 'livestore.db' } },
                  mutationLog: {
                    fileSize: mutationLogFileSize,
                    persistenceInfo: { fileName: 'livestore-mutationlog.db' },
                  },
                  ...reqPayload,
                }),
              )

              return
            }
            case 'LSD.Leader.MutationLogReq': {
              const mutationLog = yield* clientSession.leaderThread.getMutationLogData

              yield* expoDevtoolsChannel.send(Devtools.MutationLogRes.make({ mutationLog, ...reqPayload }))

              return
            }
            case 'LSD.Leader.RunMutationReq': {
              const { mutationEventEncoded: mutationEventEncoded_ } = decodedEvent
              const mutationDef = schema.mutations.get(mutationEventEncoded_.mutation)!
              // const nextMutationEventIdPair = clientSession.mutations.nextMutationEventIdPair({
              //   localOnly: mutationDef.options.localOnly,
              // })

              // const mutationEventEncoded = new MutationEvent.EncodedWithMeta({
              //   ...mutationEventEncoded_,
              //   // ...nextMutationEventIdPair,
              // })

              // const mutationEventDecoded = yield* Schema.decode(mutationEventSchema)(mutationEventEncoded)
              // yield* Queue.offer(incomingSyncMutationsQueue, {
              //   payload: { _tag: 'upstream-advance', newEvents: [mutationEventEncoded] },
              //   remaining: 0,
              // })

              // const mutationDef =
              //   schema.mutations.get(mutationEventEncoded.mutation) ??
              //   shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

              // yield* clientSession.mutations.push([mutationEventEncoded])

              yield* expoDevtoolsChannel.send(Devtools.RunMutationRes.make({ ...reqPayload }))

              return
            }
            case 'LSD.Leader.SyncingInfoReq': {
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
    // yield* expoDevtoolsChannel.send(Devtools.AppHostReady.make({ appHostId, isLeader, liveStoreVersion }))

    const onMutation = ({ mutationEventEncoded }: { mutationEventEncoded: MutationEvent.AnyEncoded }) =>
      expoDevtoolsChannel
        .send(Devtools.MutationBroadcast.make({ mutationEventEncoded, liveStoreVersion }))
        .pipe(UnexpectedError.mapToUnexpectedError)

    return {
      onMutation,
    }
  }).pipe(Effect.withSpan('@livestore/expo:bootDevtools'))
