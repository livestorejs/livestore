import {
  type PreparedBindValues,
  Schema,
  SessionIdSymbol,
  type SessionIdSymbol as SessionIdSymbolType,
  State,
  type Store,
  StoreInternalsSymbol,
} from '@livestore/livestore'

export type ClientDocumentId = string | SessionIdSymbolType

export interface ClientDocumentDefaultContext<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly store: Store<any, any>
  readonly table: TTable
  readonly id: string
}

export interface ClientDocumentEnsureResult<TValue = unknown> {
  readonly tableName: string
  readonly id: string
  readonly created: boolean
  readonly value: TValue
}

export interface ClientDocumentCommitSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly table: TTable
  readonly label?: string
}

type ClientDocumentRow<TValue> = {
  readonly id: string
  readonly value: TValue
}

export const assertClientDocumentTable = (table: State.SQLite.ClientDocumentTableDef.Any): void => {
  const tableName = table.sqliteDef.name
  if (State.SQLite.tableIsClientDocumentTable(table) === false) {
    throw new Error(`Cannot ensure non-client-document table "${tableName}"`)
  }
}

export const resolveClientDocumentId = (
  store: Store<any, any>,
  table: State.SQLite.ClientDocumentTableDef.Any,
  id: ClientDocumentId | undefined,
): string => {
  const idOrDefault = id ?? table.default.id
  if (idOrDefault === undefined) {
    throw new Error(`Client document table "${table.sqliteDef.name}" requires an explicit document id`)
  }

  return idOrDefault === SessionIdSymbol ? store.sessionId : idOrDefault
}

export const selectActiveClientDocumentRow = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  table: TTable,
  id: string,
): ClientDocumentRow<TTable['Value']> | undefined => {
  return selectClientDocumentRow(store, table, id)
}

export const createMissingClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: ClientDocumentCommitSpec<TTable>,
  id: string,
  defaultValue: TTable['Value'],
): ClientDocumentEnsureResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  // Async defaults can yield, giving another ensure call a chance to create the row first.
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

const selectClientDocumentRow = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
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
