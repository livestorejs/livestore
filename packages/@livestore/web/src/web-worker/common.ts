import type { InvalidPullError, IsOfflineError, SyncImpl } from '@livestore/common'
import {
  Devtools,
  getExecArgsFromMutation,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  prepareBindValues,
  sql,
} from '@livestore/common'
import { version as liveStoreVersion } from '@livestore/common/package.json'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema, SyncStatus } from '@livestore/common/schema'
import type { BindValues } from '@livestore/common/sql-queries'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import { memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Fiber, Stream } from '@livestore/utils/effect'
import { Context, Effect, Schema, SubscriptionRef } from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import type { StorageType } from './schema.js'

export const getAppDbFileName = (prefix: string, schemaHash: number) => {
  return `${prefix}${schemaHash}.db`
}

export const getMutationlogDbFileName = (prefix: string) => {
  return `${prefix}mutationlog.db`
}

export const getAppDbIdbStoreName = (prefix: string, schemaHash: number) => {
  return `${prefix}${schemaHash}`
}

export const getMutationlogDbIdbStoreName = (prefix: string) => {
  return `${prefix}mutationlog`
}

export const configureConnection = (db: SqliteWasm.Database, { fkEnabled }: { fkEnabled: boolean }) =>
  db.exec(sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
  `)

export type DevtoolsContext = {
  isConnected: SubscriptionRef.SubscriptionRef<boolean>
  incomingMessages: Stream.Stream<Devtools.MessageToAppHost>
  portSubRef: SubscriptionRef.SubscriptionRef<MessagePort | undefined>
  sendMessage: (
    message: Devtools.MessageFromAppHost,
    options?: {
      /** Send message even if not connected (e.g. for initial broadcast messages) */
      force: boolean
    },
  ) => Effect.Effect<void>
  channelId: string
}

export type ShutdownState = 'running' | 'shutting-down' | 'shutdown-requested'

export class OuterWorkerCtx extends Context.Tag('OuterWorkerCtx')<
  OuterWorkerCtx,
  {
    innerFiber: Fiber.RuntimeFiber<any, any>
  }
>() {}

export class WorkerCtx extends Context.Tag('WorkerCtx')<
  WorkerCtx,
  {
    _tag: 'HasLock'
    keySuffix: string
    storageOptions: StorageType
    schema: LiveStoreSchema
    ctx: {
      db: PersistedSqlite
      dbLog: PersistedSqlite
      sqlite3: SqliteWasm.Sqlite3Static
      // TODO we should find a more elegant way to handle cases which need this ref for their implementation
      shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
      mutationEventSchema: MutationEventSchema<any>
      mutationDefSchemaHashMap: Map<string, number>
      broadcastChannel: BroadcastChannel
      devtools: DevtoolsContext
      sync:
        | {
            impl: SyncImpl
            inititialMessages: Stream.Stream<MutationEvent.Any, InvalidPullError | IsOfflineError>
          }
        | undefined
    }
  }
>() {}

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.Any,
  options: {
    syncStatus: SyncStatus
    shouldBroadcast: boolean
    persisted: boolean
  },
) => void

export const makeApplyMutation = (
  workerCtx: Context.Tag.Service<WorkerCtx>,
  createdAtMemo: () => string,
  db: SqliteWasm.Database,
): ApplyMutation => {
  const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(workerCtx.schema)

  return (mutationEventEncoded, { syncStatus, shouldBroadcast, persisted }) => {
    const schema = workerCtx.schema
    const { dbLog, mutationEventSchema, mutationDefSchemaHashMap, broadcastChannel, devtools, sync } = workerCtx.ctx
    const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

    const mutationName = mutationEventDecoded.mutation
    const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

    const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

    // console.group('livestore-webworker: executing mutation', { mutationName, syncStatus, shouldBroadcast })

    for (const { statementSql, bindValues } of execArgsArr) {
      try {
        // console.debug(mutationName, statementSql, bindValues)
        db.exec({ sql: statementSql, bind: bindValues })
      } catch (e) {
        console.error('Error executing query', e, statementSql, bindValues)
        debugger
        throw e
      }
    }

    // console.groupEnd()

    // write to mutation_log
    const excludeFromMutationLogAndSyncing = shouldExcludeMutationFromLog(mutationName, mutationEventDecoded)
    if (persisted && excludeFromMutationLogAndSyncing === false) {
      const mutationDefSchemaHash =
        mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

      execSql(
        dbLog.dbRef.current,
        ...insertRow({
          tableName: MUTATION_LOG_META_TABLE,
          columns: mutationLogMetaTable.sqliteDef.columns,
          values: {
            id: mutationEventEncoded.id,
            mutation: mutationEventEncoded.mutation,
            argsJson: mutationEventEncoded.args ?? {},
            schemaHash: mutationDefSchemaHash,
            createdAt: createdAtMemo(),
            syncStatus,
          },
        }),
      )
    } else {
      //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
    }

    if (shouldBroadcast) {
      broadcastChannel.postMessage(
        Schema.encodeSync(BCMessage.Message)(
          BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'leader-worker', persisted }),
        ),
      )

      devtools
        .sendMessage(Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted, liveStoreVersion }))
        .pipe(Effect.tapCauseLogPretty, Effect.runFork)
    }

    // TODO do this via a batched queue
    if (
      excludeFromMutationLogAndSyncing === false &&
      mutationDef.options.localOnly === false &&
      sync !== undefined &&
      syncStatus === 'pending'
    ) {
      Effect.gen(function* () {
        if ((yield* SubscriptionRef.get(sync.impl.isConnected)) === false) return

        yield* sync.impl.push(mutationEventEncoded, persisted)

        execSql(
          dbLog.dbRef.current,
          ...updateRows({
            tableName: MUTATION_LOG_META_TABLE,
            columns: mutationLogMetaTable.sqliteDef.columns,
            where: { id: mutationEventEncoded.id },
            updateValues: { syncStatus: 'synced' },
          }),
        )
      }).pipe(Effect.tapCauseLogPretty, Effect.runFork)
    }
  }
}

const execSql = (db: SqliteWasm.Database, sql: string, bind: BindValues) => {
  try {
    db.exec({ sql, bind: prepareBindValues(bind, sql) })
  } catch (e) {
    console.error(e, sql, bind)
    return shouldNeverHappen(`Error writing to ${MUTATION_LOG_META_TABLE}`)
  }
}

const makeShouldExcludeMutationFromLog = memoizeByRef((schema: LiveStoreSchema) => {
  const migrationOptions = schema.migrationOptions
  const mutationLogExclude =
    migrationOptions.strategy === 'from-mutation-log'
      ? migrationOptions.excludeMutations ?? new Set(['livestore.RawSql'])
      : new Set(['livestore.RawSql'])

  return (mutationName: string, mutationEventDecoded: MutationEvent.Any): boolean => {
    if (mutationLogExclude.has(mutationName)) return true

    const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)
    const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

    return execArgsArr.some((_) => _.statementSql.includes('__livestore'))
  }
})
