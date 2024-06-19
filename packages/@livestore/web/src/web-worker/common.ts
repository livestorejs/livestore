import type { InvalidPullError, IsOfflineError, SyncImpl } from '@livestore/common'
import {
  Devtools,
  getExecArgsFromMutation,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  prepareBindValues,
  sql,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema, SyncStatus } from '@livestore/common/schema'
import type { BindValues } from '@livestore/common/sql-queries'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import { memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Stream } from '@livestore/utils/effect'
import { Context, Effect, Schema, SubscriptionRef } from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import type { StorageType } from './schema.js'

export const getAppDbFileName = (prefix: string | undefined = 'livestore', schemaHash: number) => {
  return `${prefix}-${schemaHash}.db`
}

export const getMutationlogDbFileName = (prefix: string | undefined = 'livestore') => {
  return `${prefix}-mutationlog.db`
}

export const getAppDbIdbStoreName = (prefix: string | undefined = 'livestore', schemaHash: number) => {
  return `${prefix}-${schemaHash}`
}

export const getMutationlogDbIdbStoreName = (prefix: string | undefined = 'livestore') => {
  return `${prefix}-mutationlog`
}

// NOTE we're already firing off this promise call here since we'll need it anyway and need it cached
// To improve LiveStore compatibility with e.g. Node.js we're guarding for `navigator` / `navigator.storage` to be defined.
const rootHandlePromise =
  typeof navigator === 'undefined' || navigator.storage === undefined
    ? new Promise<never>(() => {})
    : navigator.storage.getDirectory()

export const getOpfsDirHandle = async (directory: string | undefined) => {
  const rootHandle = await rootHandlePromise
  if (directory === undefined) return rootHandle

  let dirHandle = rootHandle
  const directoryStack = directory?.split('/').filter(Boolean)
  while (directoryStack.length > 0) {
    dirHandle = await dirHandle.getDirectoryHandle(directoryStack.shift()!)
  }

  return dirHandle
}

export const configureConnection = (db: SqliteWasm.Database, { fkEnabled }: { fkEnabled: boolean }) =>
  db.exec(sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
  `)

export class WorkerCtx extends Context.Tag('WorkerCtx')<
  WorkerCtx,
  | {
      _tag: 'HasLock'
      storageOptions: StorageType
      schema: LiveStoreSchema
      ctx: {
        db: PersistedSqlite
        dbLog: PersistedSqlite
        sqlite3: SqliteWasm.Sqlite3Static
        mutationEventSchema: MutationEventSchema<any>
        mutationDefSchemaHashMap: Map<string, number>
        broadcastChannel: BroadcastChannel
        devtoolsChannel: BroadcastChannel
        sync:
          | {
              impl: SyncImpl
              inititialMessages: Stream.Stream<MutationEvent.Any, InvalidPullError | IsOfflineError>
            }
          | undefined
      }
    }
  | {
      _tag: 'NoLock'
      storageOptions: StorageType
      schema: LiveStoreSchema
      ctx: undefined
    }
>() {}

export const makeApplyMutation = (
  workerCtx: Context.Tag.Service<WorkerCtx>,
  createdAtMemo: () => string,
  db: SqliteWasm.Database,
) => {
  const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(workerCtx.schema)

  return (
    mutationEventEncoded: MutationEvent.Any,
    {
      syncStatus,
      shouldBroadcast,
      persisted,
    }: { syncStatus: SyncStatus; shouldBroadcast: boolean; persisted: boolean },
  ) => {
    if (workerCtx._tag === 'NoLock') return
    const schema = workerCtx.schema
    const { dbLog, mutationEventSchema, mutationDefSchemaHashMap, broadcastChannel, devtoolsChannel, sync } =
      workerCtx.ctx
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

      devtoolsChannel.postMessage(
        Schema.encodeSync(Devtools.Message)(Devtools.MutationBroadcast.make({ mutationEventEncoded })),
      )
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
