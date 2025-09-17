import type { Adapter, ClientSession, LockStatus } from '@livestore/common'
import {
  IntentionalShutdownCause,
  liveStoreVersion,
  makeClientSession,
  StoreInterrupted,
  sessionChangesetMetaTable,
  UnexpectedError,
} from '@livestore/common'
// TODO bring back - this currently doesn't work due to https://github.com/vitejs/vite/issues/8427
// NOTE We're using a non-relative import here for Vite to properly resolve the import during app builds
// import LiveStoreSharedWorker from '@livestore/adapter-web/internal-shared-worker?sharedworker'
import { EventSequenceNumber } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { isDevEnv, shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import {
  BrowserWorker,
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ParseResult,
  Queue,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
  WebLock,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import * as OpfsUtils from '../../opfs-utils.ts'
import {
  readPersistedStateDbFromClientSession,
  resetPersistedDataFromClientSession,
} from '../common/persisted-sqlite.ts'
import { makeShutdownChannel } from '../common/shutdown-channel.ts'
import { DedicatedWorkerDisconnectBroadcast, makeWorkerDisconnectChannel } from '../common/worker-disconnect-channel.ts'
import * as WorkerSchema from '../common/worker-schema.ts'
import { connectWebmeshNodeClientSession } from './client-session-devtools.ts'
import { loadSqlite3 } from './sqlite-loader.ts'

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    opfs: OpfsUtils,
    runSync: (effect: Effect.Effect<any, any, never>) => Effect.runSync(effect),
    runFork: (effect: Effect.Effect<any, any, never>) => Effect.runFork(effect),
  }
}

export type WebAdapterOptions = {
  worker: ((options: { name: string }) => globalThis.Worker) | (new (options: { name: string }) => globalThis.Worker)
  /**
   * This is mostly an implementation detail and needed to be exposed into app code
   * due to a current Vite limitation (https://github.com/vitejs/vite/issues/8427).
   *
   * In most cases this should look like:
   * ```ts
   * import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
   *
   * const adapter = makePersistedAdapter({
   *   sharedWorker: LiveStoreSharedWorker,
   *   // ...
   * })
   * ```
   */
  sharedWorker:
    | ((options: { name: string }) => globalThis.SharedWorker)
    | (new (options: {
        name: string
      }) => globalThis.SharedWorker)
  /**
   * Specifies where to persist data for this adapter
   */
  storage: WorkerSchema.StorageTypeEncoded
  /**
   * Warning: This will reset both the app and eventlog database.
   * This should only be used during development.
   *
   * @default false
   */
  resetPersistence?: boolean
  /**
   * By default the adapter will initially generate a random clientId (via `nanoid(5)`),
   * store it in `localStorage` and restore it for subsequent client sessions. It's the same across all tabs/windows.
   */
  clientId?: string
  /**
   * By default the adapter will initially generate a random sessionId (via `nanoid(5)`),
   * store it in `sessionStorage` and restore it for subsequent client sessions in the same tab/window.
   */
  sessionId?: string
  experimental?: {
    /**
     * When set to `true`, the adapter will always start with a snapshot from the leader
     * instead of trying to load a snapshot from storage.
     *
     * @default false
     */
    disableFastPath?: boolean
    /**
     * Controls whether to wait for the shared worker to be terminated when LiveStore gets shut down.
     * This prevents a race condition where a new LiveStore instance connects to a shutting-down shared
     * worker from a previous instance.
     *
     * @default false
     *
     * @remarks
     *
     * In multi-tab scenarios, we don't want to await shared worker termination because the shared worker
     * won't actually shut down when one tab closes - it stays alive to serve other tabs. Awaiting
     * termination would cause unnecessary blocking since the termination will never happen until all
     * tabs are closed.
     */
    awaitSharedWorkerTermination?: boolean
  }
}

/**
 * Creates a web adapter with persistent storage (currently only supports OPFS).
 * Requires both a web worker and a shared worker.
 *
 * @example
 * ```ts
 * import { makePersistedAdapter } from '@livestore/adapter-web'
 * import LiveStoreWorker from './livestore.worker.ts?worker'
 * import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
 *
 * const adapter = makePersistedAdapter({
 *   worker: LiveStoreWorker,
 *   sharedWorker: LiveStoreSharedWorker,
 *   storage: { type: 'opfs' },
 * })
 * ```
 */
export const makePersistedAdapter =
  (options: WebAdapterOptions): Adapter =>
  (adapterArgs) =>
    Effect.gen(function* () {
      const {
        schema,
        storeId,
        devtoolsEnabled,
        debugInstanceId,
        bootStatusQueue,
        shutdown,
        syncPayloadSchema: _syncPayloadSchema,
        syncPayloadEncoded,
      } = adapterArgs

      // NOTE: The schema travels with the worker bundle (developers call
      // `makeWorker({ schema, syncPayloadSchema })`). We only keep the
      // destructured value here to document availability on the client session
      // side—structured cloning the Effect schema into the worker is not
      // possible, so we intentionally do not forward it.
      void _syncPayloadSchema

      yield* ensureBrowserRequirements

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const sqlite3 = yield* Effect.promise(() => loadSqlite3())

      const LIVESTORE_TAB_LOCK = `livestore-tab-lock-${storeId}`
      const LIVESTORE_SHARED_WORKER_TERMINATION_LOCK = `livestore-shared-worker-termination-lock-${storeId}`

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      if (options.resetPersistence === true) {
        yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'adapter-reset' }))

        yield* resetPersistedDataFromClientSession({ storageOptions, storeId })
      }

      // Note on fast-path booting:
      // Instead of waiting for the leader worker to boot and then get a database snapshot from it,
      // we're here trying to get the snapshot directly from storage
      // we usually speeds up the boot process by a lot.
      // We need to be extra careful though to not run into any race conditions or inconsistencies.
      // TODO also verify persisted data
      const dataFromFile =
        options.experimental?.disableFastPath === true
          ? undefined
          : yield* readPersistedStateDbFromClientSession({ storageOptions, storeId, schema })

      // The same across all client sessions (i.e. tabs, windows)
      const clientId = options.clientId ?? getPersistedId(`clientId:${storeId}`, 'local')
      // Unique per client session (i.e. tab, window)
      const sessionId = options.sessionId ?? getPersistedId(`sessionId:${storeId}`, 'session')

      const workerDisconnectChannel = yield* makeWorkerDisconnectChannel(storeId)

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((cause) =>
          shutdown(cause._tag === 'LiveStore.IntentionalShutdownCause' ? Exit.succeed(cause) : Exit.fail(cause)),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const sharedWebWorker = tryAsFunctionAndNew(options.sharedWorker, { name: `livestore-shared-worker-${storeId}` })

      if (options.experimental?.awaitSharedWorkerTermination) {
        // Relying on the lock being available is currently the only mechanism we're aware of
        // to know whether the shared worker has terminated.
        yield* Effect.addFinalizer(() => WebLock.waitForLock(LIVESTORE_SHARED_WORKER_TERMINATION_LOCK))
      }

      const sharedWorkerContext = yield* Layer.build(BrowserWorker.layer(() => sharedWebWorker))
      const sharedWorkerFiber = yield* Worker.makePoolSerialized<typeof WorkerSchema.SharedWorkerRequest.Type>({
        size: 1,
        concurrency: 100,
      }).pipe(
        Effect.provide(sharedWorkerContext),
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
        Effect.withSpan('@livestore/adapter-web:client-session:setupSharedWorker'),
        Effect.forkScoped,
      )

      const lockDeferred = yield* Deferred.make<void>()
      // It's important that we resolve the leader election in a blocking way, so there's always a leader.
      // Otherwise events could end up being dropped.
      //
      // Sorry for this pun ...
      let gotLocky = yield* WebLock.tryGetDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>(gotLocky ? 'has-lock' : 'no-lock')

      // Ideally we can come up with a simpler implementation that doesn't require this
      const waitForSharedWorkerInitialized = yield* Deferred.make<void>()
      if (gotLocky === false) {
        // Don't need to wait if we're not the leader
        yield* Deferred.succeed(waitForSharedWorkerInitialized, undefined)
      }

      const runLocked = Effect.gen(function* () {
        yield* Effect.logDebug(
          `[@livestore/adapter-web:client-session] ✅ Got lock '${LIVESTORE_TAB_LOCK}' (clientId: ${clientId}, sessionId: ${sessionId}).`,
        )

        yield* Effect.addFinalizer(() =>
          Effect.logDebug(`[@livestore/adapter-web:client-session] Releasing lock for '${LIVESTORE_TAB_LOCK}'`),
        )

        yield* SubscriptionRef.set(lockStatus, 'has-lock')

        const mc = new MessageChannel()

        // NOTE we're adding the `storeId` to the worker name to make it unique
        // and adding the `sessionId` to make it easier to debug which session a worker belongs to in logs
        const worker = tryAsFunctionAndNew(options.worker, { name: `livestore-worker-${storeId}-${sessionId}` })

        yield* Worker.makeSerialized<WorkerSchema.LeaderWorkerOuterRequest>({
          initialMessage: () => new WorkerSchema.LeaderWorkerOuterInitialMessage({ port: mc.port1, storeId, clientId }),
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          UnexpectedError.mapToUnexpectedError,
          Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
          Effect.withSpan('@livestore/adapter-web:client-session:setupDedicatedWorker'),
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        yield* workerDisconnectChannel.send(DedicatedWorkerDisconnectBroadcast.make({}))

        const sharedWorker = yield* Fiber.join(sharedWorkerFiber)
        yield* sharedWorker
          .executeEffect(
            new WorkerSchema.SharedWorkerUpdateMessagePort({
              port: mc.port2,
              liveStoreVersion,
              initial: new WorkerSchema.LeaderWorkerInnerInitialMessage({
                storageOptions,
                storeId,
                clientId,
                devtoolsEnabled,
                debugInstanceId,
                syncPayloadEncoded,
              }),
            }),
          )
          .pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
          )

        yield* Deferred.succeed(waitForSharedWorkerInitialized, undefined)

        return yield* Effect.never
      }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:lock'))

      // TODO take/give up lock when tab becomes active/passive
      if (gotLocky === false) {
        yield* Effect.logDebug(
          `[@livestore/adapter-web:client-session] ⏳ Waiting for lock '${LIVESTORE_TAB_LOCK}' (sessionId: ${sessionId})`,
        )

        // TODO find a cleaner implementation for the lock handling as we don't make use of the deferred properly right now
        yield* WebLock.waitForDeferredLock(lockDeferred, LIVESTORE_TAB_LOCK).pipe(
          Effect.andThen(() => {
            gotLocky = true
            return runLocked
          }),
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      } else {
        yield* runLocked.pipe(Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const runInWorker = <TReq extends typeof WorkerSchema.SharedWorkerRequest.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer E, infer _EI, infer R>
        ? Effect.Effect<A, UnexpectedError | E, R>
        : never =>
        Fiber.join(sharedWorkerFiber).pipe(
          // NOTE we need to wait for the shared worker to be initialized before we can send requests to it
          Effect.tap(() => waitForSharedWorkerInitialized),
          Effect.flatMap((worker) => worker.executeEffect(req) as any),
          // NOTE we want to treat worker requests as atomic and therefore not allow them to be interrupted
          // Interruption usually only happens during leader re-election or store shutdown
          // Effect.uninterruptible,
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/adapter-web:client-session:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/adapter-web:client-session:runInWorker:${req._tag}`),
          Effect.mapError((cause) =>
            Schema.is(UnexpectedError)(cause)
              ? cause
              : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                ? new UnexpectedError({ cause })
                : cause,
          ),
          Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.SharedWorkerRequest.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const sharedWorker = yield* Fiber.join(sharedWorkerFiber)
          return sharedWorker.execute(req as any).pipe(
            Stream.mapError((cause) =>
              Schema.is(UnexpectedError)(cause)
                ? cause
                : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                  ? new UnexpectedError({ cause })
                  : cause,
            ),
            Stream.withSpan(`@livestore/adapter-web:client-session:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInnerBootStatusStream()).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapErrorCause((cause) =>
          Cause.isInterruptedOnly(cause) ? Effect.void : shutdown(Exit.failCause(cause)),
        ),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Queue.awaitShutdown(bootStatusQueue).pipe(
        Effect.andThen(Fiber.interrupt(bootStatusFiber)),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      // TODO maybe bring back transfering the initially created in-memory db snapshot instead of
      // re-exporting the db
      const initialResult =
        dataFromFile === undefined
          ? yield* runInWorker(new WorkerSchema.LeaderWorkerInnerGetRecreateSnapshot()).pipe(
              Effect.map(({ snapshot, migrationsReport }) => ({
                _tag: 'from-leader-worker' as const,
                snapshot,
                migrationsReport,
              })),
            )
          : { _tag: 'fast-path' as const, snapshot: dataFromFile }

      const migrationsReport =
        initialResult._tag === 'from-leader-worker' ? initialResult.migrationsReport : { migrations: [] }

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDb = yield* makeSqliteDb({ _tag: 'in-memory' })

      sqliteDb.import(initialResult.snapshot)

      const numberOfTables =
        sqliteDb.select<{ count: number }>(`select count(*) as count from sqlite_master`)[0]?.count ?? 0
      if (numberOfTables === 0) {
        return yield* UnexpectedError.make({
          cause: `Encountered empty or corrupted database`,
          payload: { snapshotByteLength: initialResult.snapshot.byteLength, storageOptions: options.storage },
        })
      }

      // We're restoring the leader head from the SESSION_CHANGESET_META_TABLE, not from the eventlog db/table
      // in order to avoid exporting/transferring the eventlog db/table, which is important to speed up the fast path.
      const initialLeaderHeadRes = sqliteDb.select(
        sessionChangesetMetaTable
          .select('seqNumClient', 'seqNumGlobal', 'seqNumRebaseGeneration')
          .orderBy([
            { col: 'seqNumGlobal', direction: 'desc' },
            { col: 'seqNumClient', direction: 'desc' },
          ])
          .first(),
      )

      const initialLeaderHead = initialLeaderHeadRes
        ? EventSequenceNumber.make({
            global: initialLeaderHeadRes.seqNumGlobal,
            client: initialLeaderHeadRes.seqNumClient,
            rebaseGeneration: initialLeaderHeadRes.seqNumRebaseGeneration,
          })
        : EventSequenceNumber.ROOT

      // console.debug('[@livestore/adapter-web:client-session] initialLeaderHead', initialLeaderHead)

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (
            Exit.isFailure(ex) &&
            Exit.isInterrupted(ex) === false &&
            Schema.is(IntentionalShutdownCause)(Cause.squash(ex.cause)) === false &&
            Schema.is(StoreInterrupted)(Cause.squash(ex.cause)) === false
          ) {
            yield* Effect.logError('[@livestore/adapter-web:client-session] client-session shutdown', ex.cause)
          } else {
            yield* Effect.logDebug('[@livestore/adapter-web:client-session] client-session shutdown', gotLocky, ex)
          }

          if (gotLocky) {
            yield* Deferred.succeed(lockDeferred, undefined)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.orDie),
      )

      const leaderThread: ClientSession['leaderThread'] = {
        export: runInWorker(new WorkerSchema.LeaderWorkerInnerExport()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/adapter-web:client-session:export'),
        ),

        events: {
          pull: ({ cursor }) =>
            runInWorkerStream(new WorkerSchema.LeaderWorkerInnerPullStream({ cursor })).pipe(Stream.orDie),
          push: (batch) =>
            runInWorker(new WorkerSchema.LeaderWorkerInnerPushToLeader({ batch })).pipe(
              Effect.withSpan('@livestore/adapter-web:client-session:pushToLeader', {
                attributes: { batchSize: batch.length },
              }),
            ),
        },

        initialState: { leaderHead: initialLeaderHead, migrationsReport },

        getEventlogData: runInWorker(new WorkerSchema.LeaderWorkerInnerExportEventlog()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/adapter-web:client-session:getEventlogData'),
        ),

        syncState: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetLeaderSyncState()).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-web:client-session:getLeaderSyncState'),
          ),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerSyncStateStream()).pipe(Stream.orDie),
        }),

        sendDevtoolsMessage: (message) =>
          runInWorker(new WorkerSchema.LeaderWorkerInnerExtraDevtoolsMessage({ message })).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-web:client-session:devtoolsMessageForLeader'),
          ),
        networkStatus: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetNetworkStatus()).pipe(Effect.orDie),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerNetworkStatusStream()).pipe(Stream.orDie),
        }),
      }

      const sharedWorker = yield* Fiber.join(sharedWorkerFiber)

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb,
        lockStatus,
        clientId,
        sessionId,
        isLeader: gotLocky,
        leaderThread,
        webmeshMode: 'direct',
        // Can be undefined in Node.js
        origin: globalThis.location?.origin,
        connectWebmeshNode: ({ sessionInfo, webmeshNode }) =>
          connectWebmeshNodeClientSession({ webmeshNode, sessionInfo, sharedWorker, devtoolsEnabled, schema }),
        registerBeforeUnload: (onBeforeUnload) => {
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('beforeunload', onBeforeUnload)
            return () => window.removeEventListener('beforeunload', onBeforeUnload)
          }

          return () => {}
        },
      })

      return clientSession
    }).pipe(UnexpectedError.mapToUnexpectedError)

// NOTE for `local` storage we could also use the eventlog db to store the data
const getPersistedId = (key: string, storageType: 'session' | 'local') => {
  const makeId = () => nanoid(5)

  const storage =
    typeof window === 'undefined'
      ? undefined
      : storageType === 'session'
        ? sessionStorage
        : storageType === 'local'
          ? localStorage
          : shouldNeverHappen(`[@livestore/adapter-web] Invalid storage type: ${storageType}`)

  // in case of a worker, we need the id of the parent window, to keep the id consistent
  // we also need to handle the case where there are multiple workers being spawned by the same window
  if (storage === undefined) {
    return makeId()
  }

  const fullKey = `livestore:${key}`
  const storedKey = storage.getItem(fullKey)

  if (storedKey) return storedKey

  const newKey = makeId()
  storage.setItem(fullKey, newKey)

  return newKey
}

const ensureBrowserRequirements = Effect.gen(function* () {
  const validate = (condition: boolean, label: string) =>
    Effect.gen(function* () {
      if (condition) {
        return yield* UnexpectedError.make({
          cause: `[@livestore/adapter-web] Browser not supported. The LiveStore web adapter needs '${label}' to work properly`,
        })
      }
    })

  yield* Effect.all([
    validate(typeof navigator === 'undefined', 'navigator'),
    validate(navigator.locks === undefined, 'navigator.locks'),
    validate(navigator.storage === undefined, 'navigator.storage'),
    validate(crypto.randomUUID === undefined, 'crypto.randomUUID'),
    validate(typeof window === 'undefined', 'window'),
    validate(typeof sessionStorage === 'undefined', 'sessionStorage'),
  ])
})
