import type { PreparedBindValues, QueryInfo } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import type { GetResult, LiveQueryDef, ReactivityGraphContext } from './live-queries/base-class.js'
import { computed } from './live-queries/computed.js'

export const rowQueryLabel = (table: DbSchema.TableDefBase, id: string | SessionIdSymbol | undefined) =>
  `row:${table.sqliteDef.name}${id === undefined ? '' : id === SessionIdSymbol ? `:sessionId` : `:${id}`}`

export const deriveColQuery: {
  <TQueryDef extends LiveQueryDef<any, QueryInfo.None>, TCol extends keyof GetResult<TQueryDef> & string>(
    queryDef: TQueryDef,
    colName: TCol,
  ): LiveQueryDef<GetResult<TQueryDef>[TCol], QueryInfo.None>
  <TQueryDef extends LiveQueryDef<any, QueryInfo.Row>, TCol extends keyof GetResult<TQueryDef> & string>(
    queryDef: TQueryDef,
    colName: TCol,
  ): LiveQueryDef<GetResult<TQueryDef>[TCol], QueryInfo.Col>
} = (queryDef: LiveQueryDef<any, QueryInfo.Row | QueryInfo.Col>, colName: string) => {
  return computed((get) => get(queryDef)[colName], {
    label: `deriveColQuery:${queryDef.label}:${colName}`,
    queryInfo:
      queryDef.queryInfo._tag === 'Row'
        ? { _tag: 'Col', table: queryDef.queryInfo.table, column: colName, id: queryDef.queryInfo.id }
        : undefined,
    deps: [
      queryDef.queryInfo.table.sqliteDef.name,
      queryDef.queryInfo.id === SessionIdSymbol ? 'sessionId' : queryDef.queryInfo.id,
      queryDef.queryInfo._tag === 'Col' ? queryDef.queryInfo.column : undefined,
    ],
  }) as any
}

export const makeExecBeforeFirstRun =
  ({
    id,
    insertValues,
    table,
    otelContext: otelContext_,
  }: {
    id?: string | SessionIdSymbol
    insertValues?: any
    table: DbSchema.TableDefBase
    otelContext: otel.Context | undefined
  }) =>
  ({ store }: ReactivityGraphContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    if (table.options.isSingleton === false) {
      const idStr = id === SessionIdSymbol ? store.sessionId : id!
      const rowExists =
        store.syncDbWrapper.select(
          `SELECT 1 FROM '${table.sqliteDef.name}' WHERE id = ?`,
          [idStr] as any as PreparedBindValues,
          { otelContext },
        ).length === 1

      if (rowExists) return

      if (DbSchema.tableHasDerivedMutations(table) === false) {
        return shouldNeverHappen(
          `Cannot insert row for table "${table.sqliteDef.name}" which does not have 'deriveMutations: true' set`,
        )
      }

      // It's important that we only mutate and don't refresh here, as this function might be called during a render
      // and otherwise we might end up in a "reactive loop"
      store.mutate(
        { otelContext, skipRefresh: true, label: `rowQuery:${table.sqliteDef.name}:${idStr}` },
        table.insert({ id, ...insertValues }),
      )
    }
  }
