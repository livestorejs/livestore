import {
  type PreparedBindValues,
  Schema,
  SessionIdSymbol,
  type SessionIdSymbol as SessionIdSymbolType,
  State,
  type Store,
  StoreInternalsSymbol,
} from '@livestore/livestore'

export interface EnsureClientDocumentSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly id?: string | SessionIdSymbolType
  readonly default?: TTable['Value']
  readonly label?: string
}

export interface EnsureClientDocumentResult<TValue = unknown> {
  readonly tableName: string
  readonly id: string
  readonly created: boolean
  readonly value: TValue
}

/** Ensures one client document before descendants read it. */
export const ensureClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
): EnsureClientDocumentResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  assertClientDocumentTable(spec.table)

  const id = resolveClientDocumentId(store, spec.table, spec.id)
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

const assertClientDocumentTable = (table: State.SQLite.ClientDocumentTableDef.Any): void => {
  const tableName = table.sqliteDef.name
  if (State.SQLite.tableIsClientDocumentTable(table) === false) {
    throw new Error(`Cannot ensure non-client-document table "${tableName}"`)
  }
}

const resolveClientDocumentId = (
  store: Store<any, any>,
  table: State.SQLite.ClientDocumentTableDef.Any,
  id: string | SessionIdSymbolType | undefined,
): string => {
  const idOrDefault = id ?? table.default.id
  if (idOrDefault === undefined) {
    throw new Error(`Client document table "${table.sqliteDef.name}" requires an explicit document id`)
  }

  return idOrDefault === SessionIdSymbol ? store.sessionId : idOrDefault
}

const createMissingClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
  id: string,
  defaultValue: TTable['Value'],
): EnsureClientDocumentResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  // The caller may derive the default before this call, so re-check immediately before committing.
  const rowAfterDefault = selectActiveClientDocumentRow(store, spec.table, id)
  if (rowAfterDefault !== undefined) {
    return { tableName, id, created: false, value: rowAfterDefault.value }
  }

  store.commit({ label: spec.label ?? `${tableName}.ensure:${id}` }, spec.table.set(defaultValue, id))

  const createdRow = selectActiveClientDocumentRow(store, spec.table, id)
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client document "${tableName}" with id "${id}"`)
  }

  return { tableName, id, created: true, value: createdRow.value }
}

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
