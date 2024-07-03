import { makeWsSync } from '@livestore/cf-sync/sync-impl'
import type { SyncImpl } from '@livestore/common'
import { Devtools, sql, UnexpectedError } from '@livestore/common'
import { version as liveStoreVersion } from '@livestore/common/package.json'
import { type LiveStoreSchema, makeMutationEventSchema, MUTATION_LOG_META_TABLE } from '@livestore/common/schema'
import { memoizeByStringifyArgs, shouldNeverHappen } from '@livestore/utils'
import type { Context } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Effect,
  Layer,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  WorkerRunner,
} from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import { loadSqlite3Wasm } from '../sqlite-utils.js'
import type { ApplyMutation, DevtoolsContext } from './common.js'
import { configureConnection, makeApplyMutation, WorkerCtx } from './common.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import { makePersistedSqlite } from './persisted-sqlite.js'
import { fetchAndApplyRemoteMutations, recreateDb } from './recreate-db.js'
import type { ExecutionBacklogItem } from './schema.js'
import { Request } from './schema.js'

const sqlite3Promise = loadSqlite3Wasm()

export type WorkerOptions = {
  schema: LiveStoreSchema
}

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerRunner(options as unknown as WorkerOptions).pipe(
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.runFork,
  )
}

const makeWorkerRunner = ({ schema }: WorkerOptions) =>
  Effect.gen(function* (_$) {
    const mutationEventSchema = makeMutationEventSchema(schema)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const schemaHash = schema.hash

    const initialSnapshotRef = { current: undefined as any }

    return WorkerRunner.layerSerialized(Request, {
      InitialMessage: ({ storageOptions, hasLock, needsRecreate, syncOptions, key, devtools: { channelId } }) =>
        Effect.gen(function* () {
          const sqlite3 = yield* Effect.tryPromise(() => sqlite3Promise)

          const keySuffix = key ? `-${key}` : ''

          if (hasLock === false) {
            return Layer.succeed(WorkerCtx, {
              _tag: 'NoLock',
              keySuffix,
              storageOptions,
              schema,
              ctx: undefined,
            })
          }

          let sahUtils: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>> | undefined
          if (storageOptions.type === 'opfs-sahpool-experimental') {
            sahUtils = yield* Effect.tryPromise(() =>
              sqlite3.installOpfsSAHPoolVfs({ directory: storageOptions.directory }),
            )
          }

          const makeDb = makePersistedSqlite({
            storageOptions,
            kind: 'app',
            schemaHash,
            sqlite3,
            sahUtils,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: true })),
          })

          const makeDbLog = makePersistedSqlite({
            storageOptions,
            kind: 'mutationlog',
            schemaHash,
            sqlite3,
            sahUtils,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: false })),
          })

          // Might involve some async work, so we're running them concurrently
          const [db, dbLog] = yield* Effect.all([makeDb, makeDbLog], { concurrency: 2 })

          const cursor = yield* Effect.try(
            () =>
              dbLog.dbRef.current.selectValue(
                sql`SELECT id FROM ${MUTATION_LOG_META_TABLE} WHERE syncStatus = 'synced' ORDER BY id DESC LIMIT 1`,
              ) as string | undefined,
          ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

          const syncImpl =
            syncOptions === undefined ? undefined : yield* makeWsSync(syncOptions.url, syncOptions.roomId)

          const broadcastChannel = new BroadcastChannel(`livestore-sync-${schemaHash}${keySuffix}`)

          const makeSync = Effect.gen(function* () {
            if (syncImpl === undefined) return undefined

            const waitUntilOnline = SubscriptionRef.changeStreamIncludingCurrent(syncImpl.isConnected).pipe(
              Stream.filter(Boolean),
              Stream.take(1),
              Stream.runDrain,
            )

            // Wait first until we're online
            yield* waitUntilOnline

            return {
              impl: syncImpl,
              inititialMessages: syncImpl.pull(cursor),
            }
          })

          const isShuttingDownRef = { current: false as boolean }

          const sync = yield* makeSync

          const devtools = yield* makeDevtoolsContext(channelId)

          const workerCtx = {
            _tag: 'HasLock',
            keySuffix,
            storageOptions,
            schema,
            ctx: {
              isShuttingDownRef,
              sqlite3,
              db,
              dbLog,
              mutationDefSchemaHashMap,
              mutationEventSchema,
              broadcastChannel,
              devtools,
              sync,
            },
          } satisfies Context.Tag.Service<WorkerCtx>

          if (needsRecreate) {
            initialSnapshotRef.current = yield* recreateDb(workerCtx)
          } else {
            yield* fetchAndApplyRemoteMutations(workerCtx, db.dbRef.current, true)
          }

          const applyMutation = makeApplyMutation(workerCtx, () => new Date().toISOString(), db.dbRef.current)

          yield* listenToDevtools({ devtools, sync, schema, db, dbLog, applyMutation, isShuttingDownRef })

          if (syncImpl !== undefined) {
            // TODO try to do this in a batched-way if possible
            yield* syncImpl.pushes.pipe(
              Stream.tapSync(({ mutationEventEncoded, persisted }) =>
                applyMutation(mutationEventEncoded, { syncStatus: 'synced', shouldBroadcast: true, persisted }),
              ),
              Stream.runDrain,
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            )
          }

          broadcastChannel.addEventListener('message', (event) => {
            const decodedEvent = Schema.decodeUnknownOption(BCMessage.Message)(event.data)
            if (decodedEvent._tag === 'Some') {
              const { sender, mutationEventEncoded, persisted } = decodedEvent.value
              if (sender === 'ui-thread') {
                // console.log('livestore-webworker: applying mutation from ui-thread', mutationEventEncoded)

                const mutationDef =
                  schema.mutations.get(mutationEventEncoded.mutation) ??
                  shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

                applyMutation(mutationEventEncoded, {
                  syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
                  shouldBroadcast: true,
                  persisted,
                })
              }
            }
          })

          return Layer.succeed(WorkerCtx, workerCtx)
        }).pipe(
          Effect.tapCauseLogPretty,
          mapToUnexpectedError,
          Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
          Effect.withSpan('@livestore/web:worker:InitialMessage'),
          Layer.unwrapScoped,
        ),
      GetRecreateSnapshot: () =>
        Effect.sync(() => initialSnapshotRef.current).pipe(
          Effect.andThen((_: Uint8Array | undefined) =>
            _ ? Effect.succeed(_) : Effect.andThen(getWorkerCtxUnsafe, (_) => _.db.export),
          ),
          mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot'),
        ),
      Export: () =>
        Effect.andThen(getWorkerCtxUnsafe, (_) => _.db.export).pipe(
          mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:Export'),
        ),
      ExportMutationlog: () =>
        Effect.andThen(getWorkerCtxUnsafe, (_) => _.dbLog.export).pipe(
          mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ExportMutationlog'),
        ),
      ExecuteBulk: ({ items }) =>
        executeBulk(items).pipe(mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:ExecuteBulk')),
      Setup: () => Effect.never,
      NetworkStatusStream: () =>
        Effect.gen(function* (_) {
          const workerCtx = yield* WorkerCtx

          if (workerCtx.ctx?.sync === undefined) {
            return Stream.succeed({ isConnected: false, timestampMs: Date.now() })
          }

          return workerCtx.ctx.sync.impl.isConnected.changes.pipe(
            Stream.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
            Stream.tap((networkStatus) =>
              workerCtx.ctx!.devtools.sendMessage(
                Devtools.NetworkStatusChanged.make({
                  channelId: workerCtx.ctx!.devtools.channelId,
                  networkStatus,
                  liveStoreVersion,
                }),
              ),
            ),
          )
        }).pipe(Stream.unwrap),
      Shutdown: () =>
        Effect.gen(function* () {
          // TODO get rid of explicit close calls and rely on the finalizers (by dropping the scope from `InitialMessage`)
          const { db, dbLog } = yield* getWorkerCtxUnsafe
          db.dbRef.current.close()
          dbLog.dbRef.current.close()
          yield* db.close
          yield* dbLog.close
        }).pipe(mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:Shutdown')),
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(BrowserWorkerRunner.layer))

const getWorkerCtxUnsafe = Effect.gen(function* () {
  const workerCtx = yield* WorkerCtx
  if (workerCtx._tag === 'NoLock') {
    const suffix = workerCtx.keySuffix.length > 0 ? `'${workerCtx.keySuffix}' lock key` : 'default lock key'
    return yield* new UnexpectedError({ error: `Worker doesn't have lock for ${suffix}` })
  }

  return workerCtx.ctx
})

const mapToUnexpectedError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapCauseLogPretty,
    Effect.mapError((error) => (Schema.is(UnexpectedError)(error) ? error : new UnexpectedError({ error }))),
    Effect.catchAllDefect((error) => new UnexpectedError({ error })),
  )

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const workerCtx = yield* WorkerCtx
    if (workerCtx._tag === 'NoLock') return
    const { db, dbLog, isShuttingDownRef } = yield* getWorkerCtxUnsafe

    if (isShuttingDownRef.current) {
      console.warn('livestore-webworker: shutting down, skipping execution')
      return
    }

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = makeApplyMutation(workerCtx, createdAtMemo, db.dbRef.current)

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction
        dbLog.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction

        batchItems = executionItems.slice(offset, offset + 50)
        offset += 50

        // console.group('livestore-webworker: executing batch')
        // batchItems.forEach((_) => {
        //   if (_._tag === 'execute') {
        //     console.log(_.query, _.bindValues)
        //   } else if (_._tag === 'mutate') {
        //     console.log(_.mutationEventEncoded.mutation, _.mutationEventEncoded.id, _.mutationEventEncoded.args)
        //   }
        // })
        // console.groupEnd()

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.dbRef.current.exec({ sql: query, bind: bindValues })

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationDef =
              workerCtx.schema.mutations.get(item.mutationEventEncoded.mutation) ??
              shouldNeverHappen(`Unknown mutation: ${item.mutationEventEncoded.mutation}`)

            applyMutation(item.mutationEventEncoded, {
              syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
              shouldBroadcast: true,
              persisted: item.persisted,
            })
          } else {
            // TODO handle txn
          }
        }

        db.dbRef.current.exec('COMMIT') // Commit the transaction
        dbLog.dbRef.current.exec('COMMIT') // Commit the transaction
      } catch (error) {
        try {
          db.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
          dbLog.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })

const makeDevtoolsContext = (channelId: string) =>
  Effect.gen(function* () {
    const isConnected = yield* SubscriptionRef.make(false)

    const devtoolBroadcastChannels = Devtools.makeBroadcastChannels()

    const incomingMessages = Stream.fromEventListener<MessageEvent>(devtoolBroadcastChannels.toAppHost, 'message').pipe(
      Stream.map((_) => Schema.decodeSync(Devtools.MessageToAppHost)(_.data)),
    )

    const outgoingMessagesQueue = yield* Queue.unbounded<Devtools.MessageFromAppHost>()

    const sendMessage: DevtoolsContext['sendMessage'] = (message, options) =>
      Effect.gen(function* () {
        if (options?.force === true || (yield* SubscriptionRef.get(isConnected))) {
          devtoolBroadcastChannels.fromAppHost.postMessage(Schema.encodeSync(Devtools.MessageFromAppHost)(message))
        } else {
          yield* Queue.offer(outgoingMessagesQueue, message)
        }
      })

    yield* Effect.gen(function* () {
      yield* SubscriptionRef.waitUntil(isConnected, (_) => _ === true)

      const msg = yield* Queue.take(outgoingMessagesQueue)

      devtoolBroadcastChannels.fromAppHost.postMessage(Schema.encodeSync(Devtools.MessageFromAppHost)(msg))
    }).pipe(Effect.forever, Effect.tapCauseLogPretty, Effect.forkScoped)

    return { isConnected, sendMessage, incomingMessages, channelId } satisfies DevtoolsContext
  })

const listenToDevtools = ({
  devtools,
  sync,
  schema,
  db,
  dbLog,
  applyMutation,
  isShuttingDownRef,
}: {
  devtools: DevtoolsContext
  sync: { impl: SyncImpl } | undefined
  schema: LiveStoreSchema
  db: PersistedSqlite
  dbLog: PersistedSqlite
  applyMutation: ApplyMutation
  isShuttingDownRef: { current: boolean }
}) =>
  Effect.gen(function* () {
    const { channelId } = devtools

    yield* devtools.incomingMessages.pipe(
      Stream.tap((decodedEvent) =>
        Effect.gen(function* () {
          // console.debug('livestore-webworker: devtools message', decodedEvent)

          if (decodedEvent._tag === 'LSD.DevtoolsReady') {
            if ((yield* devtools.isConnected.get) === false) {
              yield* devtools.sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion }), {
                force: true,
              })
            }
            return
          }

          if (decodedEvent._tag === 'LSD.DevtoolsConnected') {
            if (yield* devtools.isConnected.get) {
              shouldNeverHappen('devtools already connected')
            }

            if (sync?.impl !== undefined) {
              const networkStatus = yield* sync.impl.isConnected.get.pipe(
                Effect.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
              )

              yield* devtools.sendMessage(
                Devtools.NetworkStatusChanged.make({
                  channelId: devtools.channelId,
                  networkStatus,
                  liveStoreVersion,
                }),
              )
            }

            yield* SubscriptionRef.set(devtools.isConnected, true)
            return
          }

          const { requestId } = decodedEvent

          if (decodedEvent.channelId !== channelId) return

          switch (decodedEvent._tag) {
            case 'LSD.Ping': {
              yield* devtools.sendMessage(Devtools.Pong.make({ requestId, liveStoreVersion }))
              break
            }
            case 'LSD.Disconnect': {
              yield* SubscriptionRef.set(devtools.isConnected, false)

              yield* devtools.sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion }), {
                force: true,
              })

              break
            }
            case 'LSD.SnapshotReq': {
              const data = yield* db.export

              yield* devtools.sendMessage(Devtools.SnapshotRes.make({ snapshot: data, requestId, liveStoreVersion }))

              break
            }
            case 'LSD.LoadSnapshotReq': {
              const { snapshot } = decodedEvent

              isShuttingDownRef.current = true

              yield* db.import(snapshot)

              yield* devtools.sendMessage(Devtools.LoadSnapshotRes.make({ requestId, liveStoreVersion }))

              break
            }
            case 'LSD.LoadMutationLogReq': {
              const { mutationLog } = decodedEvent

              isShuttingDownRef.current = true

              yield* dbLog.import(mutationLog)

              yield* db.destroy

              yield* devtools.sendMessage(Devtools.LoadMutationLogRes.make({ requestId, liveStoreVersion }))

              break
            }
            case 'LSD.MutationLogReq': {
              const mutationLog = yield* dbLog.export

              yield* devtools.sendMessage(
                Devtools.MutationLogRes.make({ mutationLog, requestId, channelId, liveStoreVersion }),
              )

              break
            }
            case 'LSD.RunMutationReq': {
              const { mutationEventEncoded, persisted } = decodedEvent

              const mutationDef =
                schema.mutations.get(mutationEventEncoded.mutation) ??
                shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

              applyMutation(mutationEventEncoded, {
                syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
                shouldBroadcast: true,
                persisted,
              })

              yield* devtools.sendMessage(Devtools.RunMutationRes.make({ requestId, channelId, liveStoreVersion }))
            }
          }
        }).pipe(Effect.withSpan('@livestore/web:worker:onDevtoolsMessage')),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* devtools.sendMessage(Devtools.AppHostReady.make({ channelId, liveStoreVersion }), { force: true })
  })
