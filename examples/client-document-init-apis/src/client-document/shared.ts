import {
  type PreparedBindValues,
  Schema,
  SessionIdSymbol,
  type SessionIdSymbol as SessionIdSymbolType,
  State,
  type Store,
  StoreInternalsSymbol,
} from '@livestore/livestore'
import type { Context, Span } from '@opentelemetry/api'

import { activeOtelContext, currentSpanLink } from '../otel.ts'

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

export const ensureTraceAttributes = (
  spec: ClientDocumentCommitSpec<State.SQLite.ClientDocumentTableDef.Any> & { readonly id?: ClientDocumentId },
  defaultKind: 'function' | 'value',
) => ({
  'client_document.table': spec.table.sqliteDef.name,
  'client_document.id.requested': String(spec.id ?? '<default-id>'),
  'client_document.label': spec.label,
  'client_document.default.kind': defaultKind,
})

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
  return selectClientDocumentRow(store, table, id, activeOtelContext())
}

export const createMissingClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: ClientDocumentCommitSpec<TTable>,
  id: string,
  defaultValue: TTable['Value'],
  span: Span,
): ClientDocumentEnsureResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  // Async defaults can yield, giving another ensure call a chance to create the row first.
  const rowAfterDefault = selectActiveClientDocumentRow(store, spec.table, id)
  if (rowAfterDefault !== undefined) {
    span.setAttribute('client_document.created', false)
    span.setAttribute('client_document.created_during_default', true)
    return { tableName, id, created: false, value: rowAfterDefault.value }
  }

  const spanLink = currentSpanLink()
  const commitOptions = {
    label: spec.label ?? `${tableName}.ensure:${id}`,
    otelContext: activeOtelContext(),
    ...(spanLink === undefined ? {} : { spanLinks: [spanLink] }),
  }

  store.commit(commitOptions, spec.table.set(defaultValue, id))

  const createdRow = selectActiveClientDocumentRow(store, spec.table, id)
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client document "${tableName}" with id "${id}"`)
  }

  span.setAttribute('client_document.created', true)
  return { tableName, id, created: true, value: createdRow.value }
}

const selectClientDocumentRow = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  table: TTable,
  id: string,
  otelContext: Context,
): ClientDocumentRow<TTable['Value']> | undefined => {
  const rows = store[StoreInternalsSymbol].sqliteDbWrapper.cachedSelect(
    `SELECT * FROM '${table.sqliteDef.name}' WHERE id = ?`,
    [id] as unknown as PreparedBindValues,
    { queriedTables: new Set([table.sqliteDef.name]), otelContext },
  )

  const rowSchema = table.rowSchema as Schema.Schema<ClientDocumentRow<TTable['Value']>, unknown, never>
  return Schema.decodeUnknownSync(Schema.Array(rowSchema))(rows)[0]
}
