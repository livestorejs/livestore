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

export type EnsureClientDocumentSyncDefaultContext<TTable extends State.SQLite.ClientDocumentTableDef.Any> =
  ClientDocumentDefaultContext<TTable>

export interface EnsureClientDocumentSyncSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly id?: ClientDocumentId
  readonly default?:
    | TTable['Value']
    | ((ctx: EnsureClientDocumentSyncDefaultContext<TTable>) => TTable['Value'])
  readonly label?: string
}

export type EnsureClientDocumentSyncResult<TValue = unknown> = ClientDocumentEnsureResult<TValue>

/** Ensures one client document whose default is known to be synchronous. */
export const ensureClientDocumentSync = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSyncSpec<TTable>,
): EnsureClientDocumentSyncResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  assertClientDocumentTable(spec.table)

  const id = resolveClientDocumentId(store, spec.table, spec.id)
  const existingRow = selectActiveClientDocumentRow(store, spec.table, id)

  if (existingRow !== undefined) {
    return { tableName, id, created: false, value: existingRow.value }
  }

  return createMissingClientDocument(store, spec, id, resolveDefaultValueSync(store, spec, id))
}

const resolveDefaultValueSync = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSyncSpec<TTable>,
  id: string,
): TTable['Value'] => {
  if (typeof spec.default === 'function') {
    const defaultFn = spec.default as (ctx: EnsureClientDocumentSyncDefaultContext<TTable>) => TTable['Value']
    return defaultFn({ store, table: spec.table, id })
  }

  return spec.default ?? spec.table.default.value
}
