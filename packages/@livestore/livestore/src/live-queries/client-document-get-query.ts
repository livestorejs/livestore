import type { PreparedBindValues } from '@livestore/common'
import { SessionIdSymbol } from '@livestore/common'
import { State } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import type { ReactivityGraphContext } from './base-class.ts'

export const rowQueryLabel = (
  table: State.SQLite.ClientDocumentTableDef.Any,
  id: string | SessionIdSymbol | undefined,
) => `${table.sqliteDef.name}.get:${id === undefined ? table.default.id : id === SessionIdSymbol ? 'sessionId' : id}`

export const makeExecBeforeFirstRun =
  ({
    id,
    explicitDefaultValues,
    table,
    otelContext: otelContext_,
  }: {
    id?: string | SessionIdSymbol
    explicitDefaultValues?: any
    table: State.SQLite.TableDefBase
    otelContext: otel.Context | undefined
  }) =>
  ({ store }: ReactivityGraphContext) => {
    if (State.SQLite.tableIsClientDocumentTable(table) === false) {
      return shouldNeverHappen(
        `Cannot insert row for table "${table.sqliteDef.name}" which does not have 'deriveEvents: true' set`,
      )
    }

    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    const idVal = id === SessionIdSymbol ? store.sessionId : id!
    const rowExists =
      store.sqliteDbWrapper.cachedSelect(
        `SELECT 1 FROM '${table.sqliteDef.name}' WHERE id = ?`,
        [idVal] as any as PreparedBindValues,
        { otelContext },
      ).length === 1

    if (rowExists) return

    // It's important that we only commit and don't refresh here, as this function might be called during a render
    // and otherwise we might end up in a "reactive loop"

    store.commit(
      { otelContext, skipRefresh: true, label: `${table.sqliteDef.name}.set:${idVal}` },
      table.set(explicitDefaultValues, idVal as TODO),
    )
  }
