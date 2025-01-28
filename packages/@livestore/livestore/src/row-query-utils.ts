import type { PreparedBindValues, QueryInfo } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import type { LiveQuery, LiveQueryAny, QueryContext } from './live-queries/base-class.js'
import { computed } from './live-queries/computed.js'

export const rowQueryLabel = (table: DbSchema.TableDefBase, id: string | SessionIdSymbol | undefined) =>
  `row:${table.sqliteDef.name}${id === undefined ? '' : id === SessionIdSymbol ? `:sessionId` : `:${id}`}`

export const deriveColQuery: {
  <TQuery extends LiveQuery<any, QueryInfo.None>, TCol extends keyof TQuery['__result!'] & string>(
    query$: TQuery,
    colName: TCol,
  ): LiveQuery<TQuery['__result!'][TCol], QueryInfo.None>
  <TQuery extends LiveQuery<any, QueryInfo.Row>, TCol extends keyof TQuery['__result!'] & string>(
    query$: TQuery,
    colName: TCol,
  ): LiveQuery<TQuery['__result!'][TCol], QueryInfo.Col>
} = (query$: LiveQueryAny, colName: string) => {
  return computed((get) => get(query$)[colName], {
    label: `deriveColQuery:${query$.label}:${colName}`,
    queryInfo:
      query$.queryInfo._tag === 'Row'
        ? { _tag: 'Col', table: query$.queryInfo.table, column: colName, id: query$.queryInfo.id }
        : undefined,
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
  ({ store }: QueryContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    if (table.options.isSingleton === false) {
      const idStr = id === SessionIdSymbol ? store.sessionId : id!
      const rowExists =
        store.syncDbWrapper.select(`SELECT 1 FROM '${table.sqliteDef.name}' WHERE id = ?`, {
          bindValues: [idStr] as any as PreparedBindValues,
        }).length === 1

      if (rowExists) return

      if (DbSchema.tableHasDerivedMutations(table) === false) {
        return shouldNeverHappen(
          `Cannot insert row for table "${table.sqliteDef.name}" which does not have 'deriveMutations: true' set`,
        )
      }

      // NOTE It's important that we only mutate and don't refresh here, as this function is called during a render
      store.mutate({ otelContext, skipRefresh: true }, table.insert({ id, ...insertValues }))
    }
  }
