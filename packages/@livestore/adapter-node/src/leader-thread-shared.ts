import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import type { ClientSessionLeaderThreadProxy, MakeSqliteDb, SqliteDb, SyncOptions } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, migrateDbForBackend, UnknownError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb, LeaderThreadCtx } from '@livestore/common/leader-thread'
import { configureConnection, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { getStateDbBaseName, type LiveStoreSchema, type StateBackendId } from '@livestore/common/schema'
import type { MakeNodeSqliteDb } from '@livestore/sqlite-wasm/node'
import { shouldNeverHappen } from '@livestore/utils'
import type { FileSystem, HttpClient, Layer, Schema, Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'

import { makeShutdownChannel } from './shutdown-channel.ts'
import type * as WorkerSchema from './worker-schema.ts'

export type TestingOverrides = {
  clientSession?: {
    leaderThreadProxy?: (
      original: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy,
    ) => Partial<ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy>
  }
  makeLeaderThread?: (makeSqliteDb: MakeSqliteDb) => Effect.Effect<
    {
      dbEventlog: SqliteDb
      dbState?: SqliteDb
      dbStates?: Map<StateBackendId, SqliteDb>
    },
    UnknownError
  >
}

export interface MakeLeaderThreadArgs {
  storeId: string
  clientId: string
  syncOptions: SyncOptions | undefined
  storage: WorkerSchema.StorageType
  makeSqliteDb: MakeNodeSqliteDb
  devtools: WorkerSchema.LeaderWorkerInnerInitialMessage['devtools']
  schema: LiveStoreSchema
  syncPayloadEncoded: Schema.JsonValue | undefined
  syncPayloadSchema: Schema.Schema<any> | undefined
  testing: TestingOverrides | undefined
}

export const makeLeaderThread = ({
  storeId,
  clientId,
  syncOptions,
  makeSqliteDb,
  storage,
  devtools,
  schema,
  syncPayloadEncoded,
  syncPayloadSchema,
  testing,
}: MakeLeaderThreadArgs): Effect.Effect<
  Layer.Layer<LeaderThreadCtx, UnknownError, Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem>,
  UnknownError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>()

    const defaultBackendId = schema.state.defaultBackendId
    const backendIds = Array.from(schema.state.backends.keys())

    const makeStateDb = (backendId: StateBackendId): Effect.Effect<SqliteDb, UnknownError, Scope.Scope> => {
      if (storage.type === 'in-memory') {
        return makeSqliteDb({
          _tag: 'in-memory',
          configureDb: (db) =>
            configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
        }).pipe(
          Effect.map((db): SqliteDb => db),
          UnknownError.mapToUnknownError,
        )
      }

      return makeSqliteDb({
        _tag: 'fs',
        directory: path.join(storage.baseDirectory ?? '', storeId),
        fileName: `${getStateDbBaseName({ schema, backendId })}@${liveStoreStorageFormatVersion}.db`,
        // TODO enable WAL for nodejs
        configureDb: (db) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
      }).pipe(
        Effect.acquireRelease((db) => Effect.sync(() => db.close())),
        Effect.map((db): SqliteDb => db),
        UnknownError.mapToUnknownError,
      )
    }

    const makeEventlogDb = (): Effect.Effect<SqliteDb, UnknownError, Scope.Scope> => {
      if (storage.type === 'in-memory') {
        return makeSqliteDb({
          _tag: 'in-memory',
          configureDb: (db) =>
            configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
        }).pipe(
          Effect.map((db): SqliteDb => db),
          UnknownError.mapToUnknownError,
        )
      }

      return makeSqliteDb({
        _tag: 'fs',
        directory: path.join(storage.baseDirectory ?? '', storeId),
        fileName: `eventlog@${liveStoreStorageFormatVersion}.db`,
        // TODO enable WAL for nodejs
        configureDb: (db) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
      }).pipe(
        Effect.acquireRelease((db) => Effect.sync(() => db.close())),
        Effect.map((db): SqliteDb => db),
        UnknownError.mapToUnknownError,
      )
    }

    const { dbEventlog, dbStates } = yield* testing?.makeLeaderThread
      ? testing.makeLeaderThread(makeSqliteDb).pipe(
          Effect.map(({ dbEventlog, dbState, dbStates }) => {
            const dbStates_ =
              dbStates ??
              (dbState === undefined ? undefined : new Map<StateBackendId, SqliteDb>([[defaultBackendId, dbState]]))

            if (dbStates_ === undefined || dbStates_.size === 0) {
              return shouldNeverHappen('Testing override must provide at least one state db.')
            }

            return { dbEventlog, dbStates: dbStates_ }
          }),
        )
      : Effect.all(
          [
            Effect.forEach(
              backendIds,
              (backendId): Effect.Effect<readonly [StateBackendId, SqliteDb], UnknownError, Scope.Scope> =>
                makeStateDb(backendId).pipe(
                  Effect.map((db): readonly [StateBackendId, SqliteDb] => [backendId, db]),
                  UnknownError.mapToUnknownError,
                ),
              { concurrency: 'unbounded' },
            ),
            makeEventlogDb(),
          ],
          { concurrency: 2 },
        ).pipe(
          Effect.map(([stateDbEntries, dbEventlog]) => ({
            dbEventlog,
            dbStates: new Map<StateBackendId, SqliteDb>(stateDbEntries),
          })),
        )

    const dbState = dbStates.get(defaultBackendId)
    if (dbState === undefined) {
      return shouldNeverHappen(`Missing default backend state db "${defaultBackendId}".`)
    }

    if (storage.type === 'in-memory' && storage.importSnapshot !== undefined) {
      dbState.import(storage.importSnapshot)
      const _migrationsReport = yield* migrateDbForBackend({ db: dbState, schema, backendId: defaultBackendId })
    }

    const devtoolsOptions = yield* makeDevtoolsOptions({ devtools, dbState, dbEventlog, storeId, clientId })

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    return makeLeaderThreadLayer({
      schema,
      storeId,
      clientId,
      makeSqliteDb,
      syncOptions,
      dbState,
      dbStates,
      dbEventlog,
      devtoolsOptions,
      shutdownChannel,
      syncPayloadEncoded,
      syncPayloadSchema,
    })
  }).pipe(
    Effect.tapCauseLogPretty,
    UnknownError.mapToUnknownError,
    Effect.withSpan('@livestore/adapter-node:makeLeaderThread', {
      attributes: { storeId, clientId, storage, devtools, syncOptions },
    }),
  )

const makeDevtoolsOptions = ({
  dbState,
  dbEventlog,
  storeId,
  clientId,
  devtools,
}: {
  dbState: LeaderSqliteDb
  dbEventlog: LeaderSqliteDb
  storeId: string
  clientId: string
  devtools: WorkerSchema.LeaderWorkerInnerInitialMessage['devtools']
}): Effect.Effect<DevtoolsOptions, UnknownError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtools.enabled === false) {
      return {
        enabled: false,
      }
    }

    return {
      enabled: true,
      boot: Effect.gen(function* () {
        // Lazy import to improve startup time
        const { startDevtoolsServer } = yield* Effect.promise(() => import('./devtools/devtools-server.ts'))

        // TODO instead of failing when the port is already in use, we should try to use that WS server instead of starting a new one
        if (devtools.useExistingDevtoolsServer === false) {
          yield* startDevtoolsServer({
            schemaPath: devtools.schemaPath,
            clientSessionInfo: Devtools.SessionInfo.SessionInfo.make({
              storeId,
              clientId,
              sessionId: 'static', // TODO make this dynamic
              schemaAlias: devtools.schemaAlias,
              isLeader: true,
              origin: undefined,
            }),
            port: devtools.port,
            host: devtools.host,
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
        }

        const node = yield* Webmesh.makeMeshNode(Devtools.makeNodeName.client.leader({ storeId, clientId }))

        yield* Webmesh.connectViaWebSocket({
          node,
          url: `http://${devtools.host}:${devtools.port}`,
          openTimeout: 500,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        const persistenceInfo = {
          state: dbState.metadata.persistenceInfo,
          eventlog: dbEventlog.metadata.persistenceInfo,
        }

        return { node, persistenceInfo, mode: 'proxy' as const }
      }),
    }
  })
