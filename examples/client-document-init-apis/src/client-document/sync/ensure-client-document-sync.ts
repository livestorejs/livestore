import { State, type Store } from '@livestore/livestore'

import {
  assertClientDocumentTable,
  createMissingClientDocument,
  type ClientDocumentEnsureResult,
  type ClientDocumentId,
  resolveClientDocumentId,
  selectActiveClientDocumentRow,
} from '../shared.ts'

export interface EnsureClientDocumentSyncSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly id?: ClientDocumentId
  readonly default?: TTable['Value']
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

  return createMissingClientDocument(store, spec, id, spec.default ?? spec.table.default.value)
}
