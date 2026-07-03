import {
  type PreparedBindValues,
  Schema,
  SessionIdSymbol,
  type SessionIdSymbol as SessionIdSymbolType,
  State,
  type Store,
  StoreInternalsSymbol,
} from '@livestore/livestore'

/**
 * Example-local explicit client-document initialization spec.
 *
 * This intentionally lives in the example while the API shape is being explored.
 * It reaches into LiveStore internals so it can check for an existing row without
 * calling `table.get(...)`, which currently has legacy write-on-read behavior.
 */
export interface EnsureClientDocumentSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  /** Client-document table to initialize. */
  readonly table: TTable

  /** Document id. Defaults to the table's configured default id when omitted. */
  readonly id?: string | SessionIdSymbolType

  /** Initial value to commit when the document is missing. Function defaults only run when missing. */
  readonly default?:
    | TTable['Value']
    | ((ctx: EnsureClientDocumentDefaultContext<TTable>) => TTable['Value'] | Promise<TTable['Value']>)

  /** Optional human-readable label for tracing/debugging. */
  readonly label?: string
}

/** Context passed to a function default while ensuring a missing client document. */
export interface EnsureClientDocumentDefaultContext<TTable extends State.SQLite.ClientDocumentTableDef.Any> {
  readonly store: Store<any, any>
  readonly table: TTable
  readonly id: string
}

/** Result returned after ensuring a client document. */
export interface EnsureClientDocumentResult<TValue = unknown> {
  readonly tableName: string
  readonly id: string
  readonly created: boolean
  readonly value: TValue
}

/** Options for ensuring client documents whose defaults depend on source data. */
export interface EnsureDerivedClientDocumentsExistOptions {
  /** Whether app-level source data is ready enough to derive defaults from. */
  readonly sourceReady: boolean

  /** Client documents to create once source data is ready. */
  readonly documents: readonly EnsureClientDocumentSpec<any>[]
}

/** Result for derived client-document initialization. */
export type EnsureDerivedClientDocumentsExistResult =
  | { readonly sourceReady: false; readonly results: readonly [] }
  | { readonly sourceReady: true; readonly results: readonly EnsureClientDocumentResult[] }

type ClientDocumentRow<TValue> = {
  readonly id: string
  readonly value: TValue
}

/** Example-local explicit ensure helper for one or more client documents. */
export const ensureClientDocuments = async (
  store: Store<any, any>,
  specs: readonly EnsureClientDocumentSpec<any>[],
): Promise<readonly EnsureClientDocumentResult[]> => {
  const results: EnsureClientDocumentResult[] = []

  for (const spec of specs) {
    if (State.SQLite.tableIsClientDocumentTable(spec.table) === false) {
      throw new Error(`Cannot ensure non-client-document table "${spec.table.sqliteDef.name}"`)
    }

    const id = resolveClientDocumentId(store, spec.table, spec.id)
    const tableName = spec.table.sqliteDef.name
    const existingRow = selectClientDocumentRow(store, spec.table, id)

    if (existingRow !== undefined) {
      results.push({ tableName, id, created: false, value: existingRow.value })
      continue
    }

    const defaultValue = await resolveDefaultValue(store, spec, id)

    // If an async default yielded, another preflight could have created the row.
    const rowAfterDefault = selectClientDocumentRow(store, spec.table, id)
    if (rowAfterDefault !== undefined) {
      results.push({ tableName, id, created: false, value: rowAfterDefault.value })
      continue
    }

    store.commit({ label: spec.label ?? `${tableName}.ensure:${id}` }, spec.table.set(defaultValue, id))

    const createdRow = selectClientDocumentRow(store, spec.table, id)
    if (createdRow === undefined) {
      throw new Error(`Failed to ensure client document "${tableName}" with id "${id}"`)
    }

    results.push({ tableName, id, created: true, value: createdRow.value })
  }

  return results
}

/**
 * Example-local helper for derived defaults.
 *
 * LiveStore can't know whether app/domain source rows are complete enough to derive
 * from, so callers provide `sourceReady`. When false, this deliberately does not
 * create the client document. When true, it delegates to `ensureClientDocuments`.
 */
export const ensureDerivedClientDocumentsExist = async (
  store: Store<any, any>,
  options: EnsureDerivedClientDocumentsExistOptions,
): Promise<EnsureDerivedClientDocumentsExistResult> => {
  if (options.sourceReady === false) {
    return { sourceReady: false, results: [] }
  }

  return { sourceReady: true, results: await ensureClientDocuments(store, options.documents) }
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

const resolveDefaultValue = async <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
  id: string,
): Promise<TTable['Value']> => {
  if (typeof spec.default === 'function') {
    const defaultFn = spec.default as (
      ctx: EnsureClientDocumentDefaultContext<TTable>,
    ) => TTable['Value'] | Promise<TTable['Value']>
    return defaultFn({ store, table: spec.table, id })
  }

  return spec.default ?? spec.table.default.value
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
