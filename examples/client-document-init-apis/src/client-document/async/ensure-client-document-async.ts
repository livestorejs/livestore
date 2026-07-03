import { State, type Store } from '@livestore/livestore'

import {
  assertClientDocumentTable,
  createMissingClientDocument,
  type ClientDocumentEnsureResult,
  type ClientDocumentId,
  resolveClientDocumentId,
  selectActiveClientDocumentRow,
} from '../shared.ts'

export interface EnsureClientDocumentAsyncSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly id?: ClientDocumentId
  readonly default?: TTable['Value']
  readonly label?: string
}

export type EnsureClientDocumentAsyncResult<TValue = unknown> = ClientDocumentEnsureResult<TValue>

/** Ensures one client document from route loaders or other async setup code. */
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

  return createMissingClientDocument(store, spec, id, spec.default ?? spec.table.default.value)
}
