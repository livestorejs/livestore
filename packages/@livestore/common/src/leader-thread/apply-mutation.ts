import { LS_DEV, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import type { PreparedBindValues, SqliteDb, SqliteError, UnexpectedError } from '../index.js'
import { getExecArgsFromMutation } from '../mutation.js'
import {
  EventId,
  getMutationDef,
  type LiveStoreSchema,
  MUTATION_LOG_META_TABLE,
  type MutationEvent,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '../schema/mod.js'
import { insertRow } from '../sql-queries/index.js'
import { execSql, execSqlPrepared } from './connection.js'
import { LeaderThreadCtx } from './types.js'

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  options?: {
    /** Needed for rehydrateFromMutationLog */
    skipMutationLog?: boolean
  },
) => Effect.Effect<void, SqliteError | UnexpectedError>

export const makeApplyMutation: Effect.Effect<ApplyMutation, never, Scope.Scope | LeaderThreadCtx> = Effect.gen(
  function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(leaderThreadCtx.schema)

    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...leaderThreadCtx.schema.mutations.map.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    return (mutationEventEncoded, options) =>
      Effect.gen(function* () {
        const { schema, dbReadModel: db, dbMutationLog } = leaderThreadCtx
        const skipMutationLog = options?.skipMutationLog ?? false

        const mutationName = mutationEventEncoded.mutation
        const mutationDef = getMutationDef(schema, mutationName)

        const execArgsArr = getExecArgsFromMutation({
          mutationDef,
          mutationEvent: { decoded: undefined, encoded: mutationEventEncoded },
        })

        // NOTE we might want to bring this back if we want to debug no-op mutations
        // const makeExecuteOptions = (statementSql: string, bindValues: any) => ({
        //   onRowsChanged: (rowsChanged: number) => {
        //     if (rowsChanged === 0) {
        //       console.warn(`Mutation "${mutationDef.name}" did not affect any rows:`, statementSql, bindValues)
        //     }
        //   },
        // })

        // console.group('[@livestore/common:leader-thread:applyMutation]', { mutationName })

        const session = db.session()

        for (const { statementSql, bindValues } of execArgsArr) {
          // console.debug(mutationName, statementSql, bindValues)
          // TODO use cached prepared statements instead of exec
          yield* execSqlPrepared(db, statementSql, bindValues)
        }

        const changeset = session.changeset()
        session.finish()

        // TODO use prepared statements
        yield* execSql(
          db,
          ...insertRow({
            tableName: SESSION_CHANGESET_META_TABLE,
            columns: sessionChangesetMetaTable.sqliteDef.columns,
            values: {
              idGlobal: mutationEventEncoded.id.global,
              idClient: mutationEventEncoded.id.client,
              // NOTE the changeset will be empty (i.e. null) for no-op mutations
              changeset: changeset ?? null,
              debug: execArgsArr,
            },
          }),
        )

        // console.groupEnd()

        // write to mutation_log
        const excludeFromMutationLog = shouldExcludeMutationFromLog(mutationName, mutationEventEncoded)
        if (skipMutationLog === false && excludeFromMutationLog === false) {
          yield* insertIntoMutationLog(
            mutationEventEncoded,
            dbMutationLog,
            mutationDefSchemaHashMap,
            mutationEventEncoded.clientId,
            mutationEventEncoded.sessionId,
          )
        } else {
          //   console.debug('[@livestore/common:leader-thread] skipping mutation log write', mutation, statementSql, bindValues)
        }
      }).pipe(
        Effect.withSpan(`@livestore/common:leader-thread:applyMutation`, {
          attributes: {
            mutationName: mutationEventEncoded.mutation,
            mutationId: mutationEventEncoded.id,
            'span.label': `(${mutationEventEncoded.id.global},${mutationEventEncoded.id.client}) ${mutationEventEncoded.mutation}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:applyMutation'),
      )
  },
)

const insertIntoMutationLog = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  dbMutationLog: SqliteDb,
  mutationDefSchemaHashMap: Map<string, number>,
  clientId: string,
  sessionId: string | undefined,
) =>
  Effect.gen(function* () {
    const mutationName = mutationEventEncoded.mutation
    const mutationDefSchemaHash =
      mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

    if (LS_DEV && mutationEventEncoded.parentId.global !== EventId.ROOT.global) {
      const parentMutationExists =
        dbMutationLog.select<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ? AND idClient = ?`,
          [mutationEventEncoded.parentId.global, mutationEventEncoded.parentId.client] as any as PreparedBindValues,
        )[0]!.count === 1

      if (parentMutationExists === false) {
        shouldNeverHappen(
          `Parent mutation ${mutationEventEncoded.parentId.global},${mutationEventEncoded.parentId.client} does not exist`,
        )
      }
    }

    // TODO use prepared statements
    yield* execSql(
      dbMutationLog,
      ...insertRow({
        tableName: MUTATION_LOG_META_TABLE,
        columns: mutationLogMetaTable.sqliteDef.columns,
        values: {
          idGlobal: mutationEventEncoded.id.global,
          idClient: mutationEventEncoded.id.client,
          parentIdGlobal: mutationEventEncoded.parentId.global,
          parentIdClient: mutationEventEncoded.parentId.client,
          mutation: mutationEventEncoded.mutation,
          argsJson: mutationEventEncoded.args ?? {},
          clientId,
          sessionId: sessionId ?? null,
          schemaHash: mutationDefSchemaHash,
          syncMetadataJson: Option.none(),
        },
      }),
    )
  })

// TODO let's consider removing this "should exclude" mechanism in favour of log compaction etc
const makeShouldExcludeMutationFromLog = memoizeByRef((schema: LiveStoreSchema) => {
  const migrationOptions = schema.migrationOptions
  const mutationLogExclude =
    migrationOptions.strategy === 'from-mutation-log'
      ? (migrationOptions.excludeMutations ?? new Set(['livestore.RawSql']))
      : new Set(['livestore.RawSql'])

  return (mutationName: string, mutationEventEncoded: MutationEvent.AnyEncoded): boolean => {
    if (mutationLogExclude.has(mutationName)) return true

    const mutationDef = getMutationDef(schema, mutationName)
    const execArgsArr = getExecArgsFromMutation({
      mutationDef,
      mutationEvent: { decoded: undefined, encoded: mutationEventEncoded },
    })

    return execArgsArr.some((_) => _.statementSql.includes('__livestore'))
  }
})
