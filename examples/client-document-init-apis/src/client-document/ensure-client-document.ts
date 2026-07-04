import { type PreparedBindValues, Schema, State, type Store, StoreInternalsSymbol } from '@livestore/livestore'

/** Input for ensuring one explicitly identified client-document row. */
export interface EnsureClientDocumentSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  /** Client-document table to read from and initialize if needed. */
  readonly table: TTable
  /** Stable document id chosen by the caller for this initialization path. */
  readonly id: string
  /** Value committed when the row does not exist; falls back to the table default value. */
  readonly default?: TTable['Value']
  /** Optional commit label for LiveStore devtools/debugging. */
  readonly label?: string
}

/** Result of an ensure attempt, whether it reused or created the row. */
export interface EnsureClientDocumentResult<TValue = unknown> {
  /** SQLite table name for the ensured client-document table. */
  readonly tableName: string
  /** Resolved document id that was checked or created. */
  readonly id: string
  /** True when this call committed the default value. */
  readonly created: boolean
  /** Current value of the ensured row. */
  readonly value: TValue
}

/**
 * Ensures a client-document row exists before descendants read it.
 *
 * This helper is intentionally synchronous: once the LiveStore instance is available,
 * reads and commits can run during boot, a route loader, or render.
 *
 * @returns The active row value and whether this call created it.
 */
export const ensureClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
): EnsureClientDocumentResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  assertClientDocumentTable(spec.table)

  const id = spec.id
  const existingRow = selectActiveClientDocumentRow(store, spec.table, id)

  if (existingRow !== undefined) {
    return { tableName, id, created: false, value: existingRow.value }
  }

  return createMissingClientDocument(store, spec, id, spec.default ?? spec.table.default.value)
}

type ClientDocumentRow<TValue> = {
  readonly id: string
  readonly value: TValue
}

/** Guards the helper so it only runs against LiveStore client-document tables. */
const assertClientDocumentTable = (table: State.SQLite.ClientDocumentTableDef.Any): void => {
  const tableName = table.sqliteDef.name
  if (State.SQLite.tableIsClientDocumentTable(table) === false) {
    throw new Error(`Cannot ensure non-client-document table "${tableName}"`)
  }
}

/**
 * Commits the default value if the row is still missing.
 */
const createMissingClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
  id: string,
  defaultValue: TTable['Value'],
): EnsureClientDocumentResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  store.commit({ label: spec.label ?? `${tableName}.ensure:${id}` }, spec.table.set(defaultValue, id))

  const createdRow = selectActiveClientDocumentRow(store, spec.table, id)
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client document "${tableName}" with id "${id}"`)
  }

  return { tableName, id, created: true, value: createdRow.value }
}

/** Reads the current row synchronously without creating a React subscription. */
const selectActiveClientDocumentRow = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  table: TTable,
  id: string,
): ClientDocumentRow<TTable['Value']> | undefined => {
  const rows = store[StoreInternalsSymbol].sqliteDbWrapper.cachedSelect(
    `SELECT * FROM '${table.sqliteDef.name}' WHERE id = ?`,
    [id] as unknown as PreparedBindValues,
    { queriedTables: new Set([table.sqliteDef.name]) },
  )

  const rowSchema = table.rowSchema as Schema.Schema<ClientDocumentRow<TTable['Value']>, unknown, never>
  return Schema.decodeUnknownSync(Schema.Array(rowSchema))(rows)[0]
}
