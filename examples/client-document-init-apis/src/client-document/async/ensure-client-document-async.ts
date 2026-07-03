import { State, type Store } from '@livestore/livestore'

import {
  assertClientDocumentTable,
  createMissingClientDocument,
  type ClientDocumentDefaultContext,
  type ClientDocumentEnsureResult,
  type ClientDocumentId,
  resolveClientDocumentId,
  selectActiveClientDocumentRow,
} from '../shared.ts'

export type EnsureClientDocumentAsyncDefaultContext<TTable extends State.SQLite.ClientDocumentTableDef.Any> =
  ClientDocumentDefaultContext<TTable>

export interface EnsureClientDocumentAsyncSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly id?: ClientDocumentId
  readonly default?:
    | TTable['Value']
    | ((ctx: EnsureClientDocumentAsyncDefaultContext<TTable>) => TTable['Value'] | Promise<TTable['Value']>)
  readonly label?: string
}

export type EnsureClientDocumentAsyncResult<TValue = unknown> = ClientDocumentEnsureResult<TValue>

/** Ensures one client document and awaits an async default when the default returns a promise. */
export const ensureClientDocumentAsync = async <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentAsyncSpec<TTable>,
): Promise<EnsureClientDocumentAsyncResult<TTable['Value']>> => {
  const tableName = spec.table.sqliteDef.name

  assertClientDocumentTable(spec.table)

  const id = resolveClientDocumentId(store, spec.table, spec.id)
  const existingRow = selectActiveClientDocumentRow(store, spec.table, id)

  if (existingRow !== undefined) {
    return { tableName, id, created: false, value: existingRow.value }
  }

  return createMissingClientDocument(store, spec, id, await resolveDefaultValueAsync(store, spec, id))
}

const resolveDefaultValueAsync = async <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentAsyncSpec<TTable>,
  id: string,
): Promise<TTable['Value']> => {
  if (typeof spec.default === 'function') {
    const defaultFn = spec.default as (
      ctx: EnsureClientDocumentAsyncDefaultContext<TTable>,
    ) => TTable['Value'] | Promise<TTable['Value']>
    return defaultFn({ store, table: spec.table, id })
  }

  return spec.default ?? spec.table.default.value
}
