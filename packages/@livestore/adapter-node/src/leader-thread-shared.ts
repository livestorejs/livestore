import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import type { ClientSessionLeaderThreadProxy, MakeSqliteDb, SqliteDb, SyncOptions } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb, LeaderThreadCtx } from '@livestore/common/leader-thread'
import { configureConnection, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { EventSequenceNumber, type LiveStoreSchema } from '@livestore/common/schema'
import type { MakeNodeSqliteDb } from '@livestore/sqlite-wasm/node'
import type { FileSystem, HttpClient, Layer, Schema, Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'

import { makeShutdownChannel } from './shutdown-channel.js'
import type * as WorkerSchema from './worker-schema.js'

export type TestingOverrides = {
  clientSession?: {
    leaderThreadProxy?: (
      original: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy,
    ) => Partial<ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy>
  }
  makeLeaderThread?: (makeSqliteDb: MakeSqliteDb) => Effect.Effect<
    {
      dbEventlog: SqliteDb
      dbState: SqliteDb
    },
    UnexpectedError
  >
}

export interface MakeLeaderThreadArgs {
  storeId: string
  clientId: string
  syncOptions: SyncOptions | undefined
  storage: WorkerSchema.StorageType
  makeSqliteDb: MakeNodeSqliteDb
  devtools: WorkerSchema.LeaderWorkerInner.InitialMessage['devtools']
  schema: LiveStoreSchema
  syncPayload: Schema.JsonValue | undefined
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
  syncPayload,
  testing,
}: MakeLeaderThreadArgs): Effect.Effect<
  Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem>,
  UnexpectedError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>()

    const schemaHashSuffix =
      schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()

    const makeDb = (kind: 'state' | 'eventlog') => {
      if (testing?.makeLeaderThread) {
        return testing
          .makeLeaderThread(makeSqliteDb)
          .pipe(Effect.map(({ dbEventlog, dbState }) => (kind === 'state' ? dbState : dbEventlog)))
      }

      return storage.type === 'in-memory'
        ? makeSqliteDb({
            _tag: 'in-memory',
            configureDb: (db) =>
              configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
            debug: kind === 'state' ? { _tag: 'state', head: EventSequenceNumber.ROOT } : { _tag: 'eventlog' },
          })
        : makeSqliteDb({
            _tag: 'fs',
            directory: path.join(storage.baseDirectory ?? '', storeId),
            fileName:
              kind === 'state' ? getStateDbFileName(schemaHashSuffix) : `eventlog@${liveStoreStorageFormatVersion}.db`,
            // TODO enable WAL for nodejs
            configureDb: (db) =>
              configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
            debug: kind === 'state' ? { _tag: 'state', head: EventSequenceNumber.ROOT } : { _tag: 'eventlog' },
          }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))
    }

    // Might involve some async work, so we're running them concurrently
    const [dbState, dbEventlog] = yield* Effect.all([makeDb('state'), makeDb('eventlog')], { concurrency: 2 })

    const devtoolsOptions = yield* makeDevtoolsOptions({ devtools, dbState, dbEventlog, storeId, clientId })

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    return makeLeaderThreadLayer({
      schema,
      storeId,
      clientId,
      makeSqliteDb,
      syncOptions,
      dbState,
      dbEventlog,
      devtoolsOptions,
      shutdownChannel,
      syncPayload,
    })
  }).pipe(
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/adapter-node:makeLeaderThread', {
      attributes: { storeId, clientId, storage, devtools, syncOptions },
    }),
  )

const getStateDbFileName = (suffix: string) => `state${suffix}@${liveStoreStorageFormatVersion}.db`

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
  devtools: WorkerSchema.LeaderWorkerInner.InitialMessage['devtools']
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope> =>
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
        const { startDevtoolsServer } = yield* Effect.promise(() => import('./devtools/devtools-server.js'))

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

        return { node, persistenceInfo, mode: 'proxy' }
      }),
    }
  })
