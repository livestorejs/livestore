/**
 * Single-tab adapter for browsers without SharedWorker support (e.g. Android Chrome).
 *
 * This adapter is a fallback for browsers that don't support the SharedWorker API.
 * It provides the same OPFS persistence as the regular persisted adapter, but without
 * multi-tab synchronization capabilities.
 *
 * **IMPORTANT**: This code is intended to be removed once SharedWorker support is
 * available in Android Chrome. Track progress at:
 * - LiveStore issue: https://github.com/livestorejs/livestore/issues/321
 * - Chromium bug: https://issues.chromium.org/issues/40290702
 *
 * @module
 */

import type { Adapter, BootWarningReason, ClientSession, LockStatus, SqliteDb } from '@livestore/common'
import {
  IntentionalShutdownCause,
  makeClientSession,
  migrateDbForBackend,
  StoreInterrupted,
  sessionChangesetMetaTable,
  UnknownError,
} from '@livestore/common'
import { EventSequenceNumber, type StateBackendId } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import {
  Cause,
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
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { BrowserWorker, Opfs, WebError } from '@livestore/utils/effect/browser'
import { nanoid } from '@livestore/utils/nanoid'
import { loadSqlite3 } from '../web-worker/client-session/sqlite-loader.ts'
import {
  readPersistedStateDbsFromClientSession,
  resetPersistedDataFromClientSession,
} from '../web-worker/common/persisted-sqlite.ts'
import { makeShutdownChannel } from '../web-worker/common/shutdown-channel.ts'
import * as WorkerSchema from '../web-worker/common/worker-schema.ts'

/**
 * Options for the single-tab adapter.
 *
 * This adapter is designed for browsers without SharedWorker support (e.g. Android Chrome).
 * It provides OPFS persistence but without multi-tab synchronization.
 *
 * @see https://github.com/livestorejs/livestore/issues/321
 * @see https://issues.chromium.org/issues/40290702
 */
export type SingleTabAdapterOptions = {
  /**
   * The dedicated web worker that runs the LiveStore leader thread.
   *
   * @example
   * ```ts
   * import LiveStoreWorker from './livestore.worker.ts?worker'
   *
   * const adapter = makeSingleTabAdapter({
   *   worker: LiveStoreWorker,
   *   storage: { type: 'opfs' },
   * })
   * ```
   */
  worker: ((options: { name: string }) => globalThis.Worker) | (new (options: { name: string }) => globalThis.Worker)

  /**
   * Storage configuration. Currently only OPFS is supported.
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
   * store it in `localStorage` and restore it for subsequent client sessions.
   */
  clientId?: string

  /**
   * By default the adapter will initially generate a random sessionId (via `nanoid(5)`),
   * store it in `sessionStorage` and restore it for subsequent client sessions in the same tab.
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
  }
}

/**
 * Creates a single-tab web adapter with OPFS persistence.
 *
 * **This adapter is a fallback for browsers without SharedWorker support** (notably Android Chrome).
 * It provides the same persistence capabilities as `makePersistedAdapter`, but without multi-tab
 * synchronization. Each browser tab runs its own independent leader worker.
 *
 * In most cases, you should use `makePersistedAdapter` instead, which automatically falls back
 * to this adapter when SharedWorker is unavailable.
 *
 * **Limitations**:
 * - No multi-tab synchronization (each tab operates independently)
 * - No devtools support (requires SharedWorker)
 * - Opening multiple tabs with the same storeId may cause data conflicts
 *
 * @see https://github.com/livestorejs/livestore/issues/321 - LiveStore tracking issue
 * @see https://issues.chromium.org/issues/40290702 - Chromium SharedWorker bug
 *
 * @example
 * ```ts
 * import { makeSingleTabAdapter } from '@livestore/adapter-web'
 * import LiveStoreWorker from './livestore.worker.ts?worker'
 *
 * // Only use this directly if you specifically need single-tab mode.
 * // Prefer makePersistedAdapter which auto-detects SharedWorker support.
 * const adapter = makeSingleTabAdapter({
 *   worker: LiveStoreWorker,
 *   storage: { type: 'opfs' },
 * })
 * ```
 */
export const makeSingleTabAdapter =
  (options: SingleTabAdapterOptions): Adapter =>
  (adapterArgs) =>
    Effect.gen(function* () {
      const { schema, storeId, bootStatusQueue, shutdown, syncPayloadEncoded } = adapterArgs
      // Note: devtoolsEnabled is ignored in single-tab mode (devtools require SharedWorker)

      yield* ensureBrowserRequirements

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const sqlite3 = yield* Effect.promise(() => loadSqlite3())

      const storageOptions = yield* Schema.decode(WorkerSchema.StorageType)(options.storage)

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      // Check OPFS availability early and notify user if storage is unavailable (e.g. private browsing)
      const opfsWarning = yield* checkOpfsAvailability
      if (opfsWarning !== undefined) {
        yield* Effect.logWarning('[@livestore/adapter-web:single-tab] OPFS unavailable', opfsWarning)
      }

      if (options.resetPersistence === true && opfsWarning === undefined) {
        yield* shutdownChannel.send(IntentionalShutdownCause.make({ reason: 'adapter-reset' }))
        yield* resetPersistedDataFromClientSession({ storageOptions, storeId })
      } else if (options.resetPersistence === true) {
        yield* Effect.logWarning(
          '[@livestore/adapter-web:single-tab] Skipping persistence reset because storage is unavailable',
          opfsWarning,
        )
      }

      // Fast-path: try to load snapshot directly from storage
      const dataFromFile =
        options.experimental?.disableFastPath === true || opfsWarning !== undefined
          ? undefined
          : yield* readPersistedStateDbsFromClientSession({ storageOptions, storeId, schema }).pipe(
              Effect.tapError((error) =>
                Effect.logDebug('[@livestore/adapter-web:single-tab] Could not read persisted state db', error, {
                  storeId,
                }),
              ),
              Effect.orElseSucceed(() => undefined),
            )

      const clientId = options.clientId ?? getPersistedId(`clientId:${storeId}`, 'local')
      const sessionId = options.sessionId ?? getPersistedId(`sessionId:${storeId}`, 'session')

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

      // In single-tab mode, we always have the lock (we're always the leader)
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      // Create MessageChannel for direct communication with the dedicated worker
      const mc = new MessageChannel()

      // Create the dedicated worker directly (no SharedWorker proxy)
      const worker = tryAsFunctionAndNew(options.worker, { name: `livestore-worker-${storeId}-${sessionId}` })

      // Set up communication with the dedicated worker via the outer protocol
      const _dedicatedWorkerFiber = yield* Worker.makeSerialized<WorkerSchema.LeaderWorkerOuterRequest>({
        initialMessage: () => new WorkerSchema.LeaderWorkerOuterInitialMessage({ port: mc.port1, storeId, clientId }),
      }).pipe(
        Effect.provide(BrowserWorker.layer(() => worker)),
        UnknownError.mapToUnknownError,
        Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
        Effect.withSpan('@livestore/adapter-web:single-tab:setupDedicatedWorker'),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      // Set up the inner worker communication via port2 (like SharedWorker would do)
      // BrowserWorker.layer accepts a MessagePort as well as a Worker
      const innerWorkerContext = yield* Layer.build(BrowserWorker.layer(() => mc.port2 as unknown as globalThis.Worker))
      const innerWorkerFiber = yield* Worker.makePoolSerialized<WorkerSchema.LeaderWorkerInnerRequest>({
        size: 1,
        concurrency: 100,
        initialMessage: () =>
          new WorkerSchema.LeaderWorkerInnerInitialMessage({
            storageOptions,
            storeId,
            clientId,
            // Devtools disabled in single-tab mode (requires SharedWorker)
            devtoolsEnabled: false,
            debugInstanceId: adapterArgs.debugInstanceId,
            syncPayloadEncoded,
          }),
      }).pipe(
        Effect.provide(innerWorkerContext),
        Effect.tapCauseLogPretty,
        UnknownError.mapToUnknownError,
        Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
        Effect.withSpan('@livestore/adapter-web:single-tab:setupInnerWorker'),
        Effect.forkScoped,
      )

      // Helper to run requests against the worker
      const runInWorker = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer E, infer _EI, infer R>
        ? Effect.Effect<A, UnknownError | E, R>
        : never =>
        Fiber.join(innerWorkerFiber).pipe(
          Effect.flatMap((worker) => worker.executeEffect(req) as any),
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/adapter-web:single-tab:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/adapter-web:single-tab:runInWorker:${req._tag}`),
          Effect.mapError((cause) =>
            Schema.is(UnknownError)(cause)
              ? cause
              : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                ? new UnknownError({ cause })
                : cause,
          ),
          Effect.catchAllDefect((cause) => new UnknownError({ cause })),
        ) as any

      const runInWorkerStream = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnknownError, R>
        : never =>
        Effect.gen(function* () {
          const innerWorker = yield* Fiber.join(innerWorkerFiber)
          return innerWorker.execute(req as any).pipe(
            Stream.mapError((cause) =>
              Schema.is(UnknownError)(cause)
                ? cause
                : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                  ? new UnknownError({ cause })
                  : cause,
            ),
            Stream.withSpan(`@livestore/adapter-web:single-tab:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      // Forward boot status from worker
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

      // Get initial snapshot (either from fast-path or from worker)
      const initialResult =
        dataFromFile === undefined
          ? yield* runInWorker(new WorkerSchema.LeaderWorkerInnerGetRecreateSnapshot()).pipe(
              Effect.map(({ snapshotsByBackend, migrationsReport }) => ({
                _tag: 'from-leader-worker' as const,
                snapshotsByBackend: new Map<StateBackendId, Uint8Array<ArrayBufferLike>>(snapshotsByBackend),
                migrationsReport,
              })),
            )
          : { _tag: 'fast-path' as const, snapshotsByBackend: dataFromFile }

      const migrationsReport =
        initialResult._tag === 'from-leader-worker' ? initialResult.migrationsReport : { migrations: [] }

      const makeSqliteDb = sqliteDbFactory({ sqlite3 })
      const sqliteDbs = yield* Effect.gen(function* () {
        const dbs = new Map<StateBackendId, SqliteDb>()

        for (const backendId of schema.state.backends.keys()) {
          const db = yield* makeSqliteDb({ _tag: 'in-memory' })
          const snapshot = initialResult.snapshotsByBackend.get(backendId)

          if (snapshot !== undefined) {
            db.import(new Uint8Array(snapshot))
          } else {
            const _migrationsReport = yield* migrateDbForBackend({ db, schema, backendId })
          }

          dbs.set(backendId, db)
        }

        return dbs
      })

      const sqliteDb = sqliteDbs.get(schema.state.defaultBackendId)
      if (sqliteDb === undefined) {
        return shouldNeverHappen(`Missing sqlite db for default backend "${schema.state.defaultBackendId}".`)
      }

      const numberOfTables =
        sqliteDb.select<{ count: number }>(`select count(*) as count from sqlite_master`)[0]?.count ?? 0
      if (numberOfTables === 0) {
        const defaultSnapshot = initialResult.snapshotsByBackend.get(schema.state.defaultBackendId)
        return yield* UnknownError.make({
          cause: `Encountered empty or corrupted database`,
          payload: { snapshotByteLength: defaultSnapshot?.byteLength ?? 0, storageOptions: options.storage },
        })
      }

      // Restore leader head from SESSION_CHANGESET_META_TABLE
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
        ? EventSequenceNumber.Client.Composite.make({
            global: initialLeaderHeadRes.seqNumGlobal,
            client: initialLeaderHeadRes.seqNumClient,
            rebaseGeneration: initialLeaderHeadRes.seqNumRebaseGeneration,
          })
        : EventSequenceNumber.Client.ROOT

      for (const db of sqliteDbs.values()) {
        db.debug.head = initialLeaderHead
      }

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (
            Exit.isFailure(ex) &&
            Exit.isInterrupted(ex) === false &&
            Schema.is(IntentionalShutdownCause)(Cause.squash(ex.cause)) === false &&
            Schema.is(StoreInterrupted)(Cause.squash(ex.cause)) === false
          ) {
            yield* Effect.logError('[@livestore/adapter-web:single-tab] client-session shutdown', ex.cause)
          } else {
            yield* Effect.logDebug('[@livestore/adapter-web:single-tab] client-session shutdown', ex)
          }
        }).pipe(Effect.tapCauseLogPretty, Effect.orDie),
      )

      const leaderThread: ClientSession['leaderThread'] = {
        export: runInWorker(new WorkerSchema.LeaderWorkerInnerExport()).pipe(
          Effect.timeout(10_000),
          UnknownError.mapToUnknownError,
          Effect.withSpan('@livestore/adapter-web:single-tab:export'),
        ),

        events: {
          pull: ({ cursor }) =>
            runInWorkerStream(new WorkerSchema.LeaderWorkerInnerPullStream({ cursor })).pipe(Stream.orDie),
          push: (batch) =>
            runInWorker(new WorkerSchema.LeaderWorkerInnerPushToLeader({ batch })).pipe(
              Effect.withSpan('@livestore/adapter-web:single-tab:pushToLeader', {
                attributes: { batchSize: batch.length },
              }),
            ),
          stream: (options) =>
            runInWorkerStream(new WorkerSchema.LeaderWorkerInnerStreamEvents(options)).pipe(
              Stream.withSpan('@livestore/adapter-web:single-tab:streamEvents'),
              Stream.orDie,
            ),
        },

        initialState: {
          leaderHead: initialLeaderHead,
          migrationsReport,
          storageMode: opfsWarning === undefined ? 'persisted' : 'in-memory',
        },

        getEventlogData: runInWorker(new WorkerSchema.LeaderWorkerInnerExportEventlog()).pipe(
          Effect.timeout(10_000),
          UnknownError.mapToUnknownError,
          Effect.withSpan('@livestore/adapter-web:single-tab:getEventlogData'),
        ),

        syncState: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetLeaderSyncState()).pipe(
            UnknownError.mapToUnknownError,
            Effect.withSpan('@livestore/adapter-web:single-tab:getLeaderSyncState'),
          ),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerSyncStateStream()).pipe(Stream.orDie),
        }),

        sendDevtoolsMessage: (_message) =>
          // Devtools not supported in single-tab mode
          Effect.void,

        networkStatus: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetNetworkStatus()).pipe(Effect.orDie),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerNetworkStatusStream()).pipe(Stream.orDie),
        }),
      }

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDbs,
        lockStatus,
        clientId,
        sessionId,
        isLeader: true, // Always leader in single-tab mode
        leaderThread,
        webmeshMode: 'direct',
        origin: globalThis.location?.origin,
        // No webmesh connection in single-tab mode (devtools disabled)
        connectWebmeshNode: () => Effect.void,
        registerBeforeUnload: (onBeforeUnload) => {
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('beforeunload', onBeforeUnload)
            return () => window.removeEventListener('beforeunload', onBeforeUnload)
          }
          return () => {}
        },
      })

      return clientSession
    }).pipe(Effect.provide(Opfs.Opfs.Default), UnknownError.mapToUnknownError)

/** Persists clientId/sessionId to storage */
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
        return yield* UnknownError.make({
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

/**
 * Attempts to access OPFS and returns a warning if unavailable.
 */
const checkOpfsAvailability = Effect.gen(function* () {
  const opfs = yield* Opfs.Opfs
  return yield* opfs.getRootDirectoryHandle.pipe(
    Effect.as(undefined),
    Effect.catchAll((error) => {
      const reason: BootWarningReason =
        Schema.is(WebError.SecurityError)(error) || Schema.is(WebError.NotAllowedError)(error)
          ? 'private-browsing'
          : 'storage-unavailable'
      const message =
        reason === 'private-browsing'
          ? 'Storage unavailable in private browsing mode. LiveStore will continue without persistence.'
          : 'Storage access denied. LiveStore will continue without persistence.'
      return Effect.succeed({ reason, message } as const)
    }),
  )
})
