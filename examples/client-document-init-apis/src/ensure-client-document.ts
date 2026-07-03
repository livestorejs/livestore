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

import { activeOtelContext, currentSpanLink, withTraceSpan } from './otel.ts'

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

/** Client-document initialization spec for APIs that deliberately do not support async defaults. */
export type EnsureClientDocumentSyncSpec<TTable extends State.SQLite.ClientDocumentTableDef.Any> = Omit<
  EnsureClientDocumentSpec<TTable>,
  'default'
> & {
  readonly default?: TTable['Value'] | ((ctx: EnsureClientDocumentDefaultContext<TTable>) => TTable['Value'])
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

type SyncOrPromise<T> = T | PromiseLike<T>

/** Example-local explicit ensure helper for one or more client documents. */
export const ensureClientDocuments = async (
  store: Store<any, any>,
  specs: readonly EnsureClientDocumentSpec<any>[],
): Promise<readonly EnsureClientDocumentResult[]> => {
  return ensureClientDocumentsSyncOrPromise(store, specs)
}

/** Ensures client documents whose defaults are known to be synchronous. */
export const ensureClientDocumentsSync = (
  store: Store<any, any>,
  specs: readonly EnsureClientDocumentSyncSpec<any>[],
): readonly EnsureClientDocumentResult[] => {
  return withTraceSpan(
    'client_document.ensure.batch',
    { 'client_document.ensure.count': specs.length },
    (batchSpan) => {
      const results = specs.map((spec) => ensureClientDocumentSync(store, spec))
      return finishEnsureBatch(batchSpan, results)
    },
  )
}

/**
 * Ensures client documents without forcing an async boundary when all defaults
 * are synchronously available.
 */
export const ensureClientDocumentsSyncOrPromise = (
  store: Store<any, any>,
  specs: readonly EnsureClientDocumentSpec<any>[],
): SyncOrPromise<readonly EnsureClientDocumentResult[]> => {
  return withTraceSpan(
    'client_document.ensure.batch',
    { 'client_document.ensure.count': specs.length },
    (batchSpan) => {
      const results: EnsureClientDocumentResult[] = []

      for (let index = 0; index < specs.length; index++) {
        const spec = specs[index]
        if (spec === undefined) continue

        const result = ensureClientDocumentSyncOrPromise(store, spec)
        if (isPromiseLike(result)) {
          return result.then((resolvedResult) =>
            ensureRemainingClientDocuments(store, specs, index + 1, [...results, resolvedResult], batchSpan),
          )
        }
        results.push(result)
      }

      return finishEnsureBatch(batchSpan, results)
    },
  )
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
  return ensureDerivedClientDocumentsExistSyncOrPromise(store, options)
}

/** Sync-or-Promise variant used by Suspense callers to avoid needless fallback throttling. */
export const ensureDerivedClientDocumentsExistSyncOrPromise = (
  store: Store<any, any>,
  options: EnsureDerivedClientDocumentsExistOptions,
): SyncOrPromise<EnsureDerivedClientDocumentsExistResult> => {
  return withTraceSpan(
    'client_document.ensure_derived',
    {
      'client_document.derived.source_ready': options.sourceReady,
      'client_document.ensure.count': options.documents.length,
    },
    () => {
      if (options.sourceReady === false) {
        return { sourceReady: false, results: [] }
      }

      const results = ensureClientDocumentsSyncOrPromise(store, options.documents)
      if (isPromiseLike(results)) {
        return results.then((resolvedResults) => ({ sourceReady: true, results: resolvedResults }))
      }

      return { sourceReady: true, results }
    },
  )
}

const ensureRemainingClientDocuments = async (
  store: Store<any, any>,
  specs: readonly EnsureClientDocumentSpec<any>[],
  startIndex: number,
  results: readonly EnsureClientDocumentResult[],
  batchSpan: Span,
): Promise<readonly EnsureClientDocumentResult[]> => {
  const nextResults = [...results]

  for (let index = startIndex; index < specs.length; index++) {
    const spec = specs[index]
    if (spec === undefined) continue

    nextResults.push(await ensureClientDocumentSyncOrPromise(store, spec))
  }

  return finishEnsureBatch(batchSpan, nextResults)
}

const finishEnsureBatch = (
  batchSpan: Span,
  results: readonly EnsureClientDocumentResult[],
): readonly EnsureClientDocumentResult[] => {
  batchSpan.setAttribute('client_document.ensure.created_count', results.filter((result) => result.created).length)
  return results
}

const ensureClientDocumentSync = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSyncSpec<TTable>,
): EnsureClientDocumentResult<TTable['Value']> => {
  return withTraceSpan(
    'client_document.ensure',
    {
      'client_document.table': spec.table.sqliteDef.name,
      'client_document.id.requested': String(spec.id ?? '<default-id>'),
      'client_document.label': spec.label,
      'client_document.default.kind': typeof spec.default === 'function' ? 'function' : 'value',
    },
    (span) => {
      const tableName = spec.table.sqliteDef.name

      if (State.SQLite.tableIsClientDocumentTable(spec.table) === false) {
        throw new Error(`Cannot ensure non-client-document table "${tableName}"`)
      }

      const id = resolveClientDocumentId(store, spec.table, spec.id)
      span.setAttribute('client_document.id', id)
      const existingRow = selectClientDocumentRow(store, spec.table, id, activeOtelContext())

      if (existingRow !== undefined) {
        span.setAttribute('client_document.exists_before_ensure', true)
        span.setAttribute('client_document.created', false)
        return { tableName, id, created: false, value: existingRow.value }
      }

      span.setAttribute('client_document.exists_before_ensure', false)
      return createMissingClientDocument(store, spec, id, resolveDefaultValueSync(store, spec, id), span)
    },
  )
}

const ensureClientDocumentSyncOrPromise = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
): SyncOrPromise<EnsureClientDocumentResult<TTable['Value']>> => {
  return withTraceSpan(
    'client_document.ensure',
    {
      'client_document.table': spec.table.sqliteDef.name,
      'client_document.id.requested': String(spec.id ?? '<default-id>'),
      'client_document.label': spec.label,
      'client_document.default.kind': typeof spec.default === 'function' ? 'function' : 'value',
    },
    (span) => {
      const tableName = spec.table.sqliteDef.name

      if (State.SQLite.tableIsClientDocumentTable(spec.table) === false) {
        throw new Error(`Cannot ensure non-client-document table "${tableName}"`)
      }

      const id = resolveClientDocumentId(store, spec.table, spec.id)
      span.setAttribute('client_document.id', id)
      const existingRow = selectClientDocumentRow(store, spec.table, id, activeOtelContext())

      if (existingRow !== undefined) {
        span.setAttribute('client_document.exists_before_ensure', true)
        span.setAttribute('client_document.created', false)
        return { tableName, id, created: false, value: existingRow.value }
      }

      span.setAttribute('client_document.exists_before_ensure', false)
      const defaultValue = resolveDefaultValueSyncOrPromise(store, spec, id)
      if (isPromiseLike(defaultValue)) {
        const defaultPromise = defaultValue as PromiseLike<TTable['Value']>
        return defaultPromise.then((resolvedDefaultValue) =>
          createMissingClientDocument(store, spec, id, resolvedDefaultValue, span),
        )
      }

      return createMissingClientDocument(store, spec, id, defaultValue, span)
    },
  )
}

const createMissingClientDocument = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
  id: string,
  defaultValue: TTable['Value'],
  span: Span,
): EnsureClientDocumentResult<TTable['Value']> => {
  const tableName = spec.table.sqliteDef.name

  // If an async default yielded, another Suspense ensure could have created the row.
  const rowAfterDefault = selectClientDocumentRow(store, spec.table, id, activeOtelContext())
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

  const createdRow = selectClientDocumentRow(store, spec.table, id, activeOtelContext())
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client document "${tableName}" with id "${id}"`)
  }

  span.setAttribute('client_document.created', true)
  return { tableName, id, created: true, value: createdRow.value }
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

const resolveDefaultValueSync = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSyncSpec<TTable>,
  id: string,
): TTable['Value'] => {
  if (typeof spec.default === 'function') {
    const defaultFn = spec.default as (ctx: EnsureClientDocumentDefaultContext<TTable>) => TTable['Value']
    return defaultFn({ store, table: spec.table, id })
  }

  return spec.default ?? spec.table.default.value
}

const resolveDefaultValueSyncOrPromise = <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  spec: EnsureClientDocumentSpec<TTable>,
  id: string,
): SyncOrPromise<TTable['Value']> => {
  if (typeof spec.default === 'function') {
    const defaultFn = spec.default as (
      ctx: EnsureClientDocumentDefaultContext<TTable>,
    ) => TTable['Value'] | Promise<TTable['Value']>
    return defaultFn({ store, table: spec.table, id })
  }

  return spec.default ?? spec.table.default.value
}

const isPromiseLike = <T>(value: T): value is T & PromiseLike<Awaited<T>> => {
  return typeof value === 'object' && value !== null && 'then' in value
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
