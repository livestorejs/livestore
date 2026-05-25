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

import type { Adapter, BootWarningReason, ClientSession, LockStatus } from '@livestore/common'
import {
  IntentionalShutdownCause,
  isWorkerTransportError,
  makeClientSession,
  StoreInterrupted,
  sessionChangesetMetaTable,
  UnknownError,
} from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { shouldNeverHappen, tryAsFunctionAndNew } from '@livestore/utils'
import {
  Cause,
  EffectRpcClient,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
  RpcWorker,
} from '@livestore/utils/effect'
import { BrowserWorker, Opfs, WebError } from '@livestore/utils/effect/browser'
import { nanoid } from '@livestore/utils/nanoid'

import { loadSqlite3 } from '../web-worker/client-session/sqlite-loader.ts'
import {
  readPersistedStateDbFromClientSession,
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

      const storageOptions = yield* Schema.decodeEffect(WorkerSchema.StorageType)(options.storage)

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
          : yield* readPersistedStateDbFromClientSession({ storageOptions, storeId, schema }).pipe(
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
        Stream.mapEffect(Effect.fromResult),
        Stream.tap((cause) =>
          shutdown(cause._tag === 'IntentionalShutdownCause' ? Exit.succeed(cause) : Exit.fail(cause)),
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
      const outerWorkerLayer = EffectRpcClient.layerProtocolWorker({ size: 1, concurrency: 1 }).pipe(
        Layer.provide(
          RpcWorker.layerInitialMessage(
            WorkerSchema.LeaderWorkerOuterInitialMessage,
            Effect.succeed(new WorkerSchema.LeaderWorkerOuterInitialMessage({ port: mc.port1, storeId, clientId })),
          ),
        ),
        Layer.provide(BrowserWorker.layer(() => worker)),
      )

      const _dedicatedWorkerFiber = yield* Effect.gen(function* () {
        const scope = yield* Effect.scope
        const protocolContext = yield* Layer.buildWithScope(outerWorkerLayer, scope)
        const outerWorker = yield* EffectRpcClient.make(WorkerSchema.LeaderWorkerOuterRpcs).pipe(
          Effect.provide(protocolContext),
        )
        yield* outerWorker.Ready(undefined)
        return yield* Effect.never
      }).pipe(
        UnknownError.mapToUnknownError,
        Effect.tapCause((cause) => shutdown(Exit.failCause(cause))),
        Effect.withSpan('@livestore/adapter-web:single-tab:setupDedicatedWorker'),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      // Set up the inner worker communication via port2 (like SharedWorker would do)
      // BrowserWorker.layer accepts a MessagePort as well as a Worker
      const innerWorkerLayer = EffectRpcClient.layerProtocolWorker({ size: 1, concurrency: 100 }).pipe(
        Layer.provide(
          RpcWorker.layerInitialMessage(
            WorkerSchema.LeaderWorkerInnerInitialMessage,
            Effect.succeed(
              new WorkerSchema.LeaderWorkerInnerInitialMessage({
                storageOptions,
                storeId,
                clientId,
                // Devtools disabled in single-tab mode (requires SharedWorker)
                devtoolsEnabled: false,
                debugInstanceId: adapterArgs.debugInstanceId,
                syncPayloadEncoded,
              }),
            ),
          ),
        ),
        Layer.provide(BrowserWorker.layer(() => mc.port2 as unknown as globalThis.Worker)),
      )

      const innerWorkerFiber = yield* Effect.gen(function* () {
        const scope = yield* Effect.scope
        const protocolContext = yield* Layer.buildWithScope(innerWorkerLayer, scope)
        return yield* EffectRpcClient.make(WorkerSchema.LeaderWorkerInnerRpcs).pipe(Effect.provide(protocolContext))
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.orDie,
        Effect.tapCause((cause) => shutdown(Exit.failCause(cause))),
        Effect.withSpan('@livestore/adapter-web:single-tab:setupInnerWorker'),
        Effect.forkScoped,
      )

      // Helper to run requests against the worker
      const runInWorker = <A, E>(tag: string, effect: Effect.Effect<A, E, any>): Effect.Effect<A, never, never> =>
        Fiber.join(innerWorkerFiber).pipe(
          Effect.flatMap(() => effect),
          Effect.catchIf(isWorkerTransportError, (e) => Effect.die(e)),
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/adapter-web:single-tab:runInWorker:${tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/adapter-web:single-tab:runInWorker:${tag}`),
        ) as Effect.Effect<A, never, never>

      const runInWorkerStream = <A, E>(tag: string, stream: Stream.Stream<A, E, any>): Stream.Stream<A, never, never> =>
        Effect.gen(function* () {
          yield* Fiber.join(innerWorkerFiber)
          return stream.pipe(
            Stream.catchIf(isWorkerTransportError, (e) => Stream.die(e)),
            Stream.withSpan(`@livestore/adapter-web:single-tab:runInWorkerStream:${tag}`),
          )
        }).pipe(Stream.unwrap) as Stream.Stream<A, never, never>

      // Forward boot status from worker
      const innerWorker = yield* Fiber.join(innerWorkerFiber)
      const bootStatusFiber = yield* runInWorkerStream('BootStatusStream', innerWorker.BootStatusStream(undefined)).pipe(
        Stream.tap((_) => Queue.offer(bootStatusQueue, _)),
        Stream.runDrain,
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause) === true ? Effect.void : shutdown(Exit.failCause(cause)),
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
          ? yield* runInWorker('GetRecreateSnapshot', innerWorker.GetRecreateSnapshot(undefined)).pipe(
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
        return yield* UnknownError.make({
          cause: `Encountered empty or corrupted database`,
          payload: { snapshotByteLength: initialResult.snapshot.byteLength, storageOptions: options.storage },
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

      const initialLeaderHead =
        initialLeaderHeadRes !== undefined
          ? EventSequenceNumber.Client.Composite.make({
              global: initialLeaderHeadRes.seqNumGlobal,
              client: initialLeaderHeadRes.seqNumClient,
              rebaseGeneration: initialLeaderHeadRes.seqNumRebaseGeneration,
            })
          : EventSequenceNumber.Client.ROOT

      yield* Effect.addFinalizer((ex) =>
        Effect.gen(function* () {
          if (
            Exit.isFailure(ex) === true &&
            Cause.hasInterruptsOnly(ex.cause) === false &&
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
        export: runInWorker('Export', innerWorker.Export(undefined)).pipe(
          Effect.timeoutOrDie(10_000),
          Effect.withSpan('@livestore/adapter-web:single-tab:export'),
        ),

        events: {
          pull: ({ cursor }) =>
            runInWorkerStream('PullStream', innerWorker.PullStream({ cursor })).pipe(Stream.orDie),
          push: (batch) =>
            runInWorker('PushToLeader', innerWorker.PushToLeader({ batch })).pipe(
              Effect.withSpan('@livestore/adapter-web:single-tab:pushToLeader', {
                attributes: { batchSize: batch.length },
              }),
            ),
          stream: (options) =>
            runInWorkerStream('StreamEvents', innerWorker.StreamEvents(options)).pipe(
              Stream.withSpan('@livestore/adapter-web:single-tab:streamEvents'),
              Stream.orDie,
            ),
        },

        initialState: {
          leaderHead: initialLeaderHead,
          migrationsReport,
          storageMode: opfsWarning === undefined ? 'persisted' : 'in-memory',
        },

        getEventlogData: runInWorker('ExportEventlog', innerWorker.ExportEventlog(undefined)).pipe(
          Effect.timeoutOrDie(10_000),
          Effect.withSpan('@livestore/adapter-web:single-tab:getEventlogData'),
        ),

        syncState: Subscribable.make({
          get: runInWorker('GetLeaderSyncState', innerWorker.GetLeaderSyncState(undefined)).pipe(
            Effect.withSpan('@livestore/adapter-web:single-tab:getLeaderSyncState'),
          ),
          changes: runInWorkerStream('SyncStateStream', innerWorker.SyncStateStream(undefined)).pipe(Stream.orDie),
        }),

        sendDevtoolsMessage: (_message) =>
          // Devtools not supported in single-tab mode
          Effect.void,

        networkStatus: Subscribable.make({
          get: runInWorker('GetNetworkStatus', innerWorker.GetNetworkStatus(undefined)).pipe(Effect.orDie),
          changes: runInWorkerStream('NetworkStatusStream', innerWorker.NetworkStatusStream(undefined)).pipe(Stream.orDie),
        }),
      }

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb,
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
    }).pipe(Effect.provide(Opfs.layer), UnknownError.mapToUnknownError)

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
          : shouldNeverHappen(`[@livestore/adapter-web] Invalid storage type: ${String(storageType)}`)

  if (storage === undefined) {
    return makeId()
  }

  const fullKey = `livestore:${key}`
  const storedKey = storage.getItem(fullKey)

  if (storedKey !== null) return storedKey

  const newKey = makeId()
  storage.setItem(fullKey, newKey)

  return newKey
}

const ensureBrowserRequirements = Effect.gen(function* () {
  const validate = (condition: boolean, label: string) =>
    Effect.gen(function* () {
      if (condition === true) {
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
    Effect.catch((error) => {
      const reason: BootWarningReason =
        Schema.is(WebError.SecurityError)(error) === true || Schema.is(WebError.NotAllowedError)(error) === true
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
