import type { LiveStoreEvent, Queryable, State } from '@livestore/livestore'

export type EnsureClientOnlyRowTable = State.SQLite.TableDef.Any & {
  readonly sqliteDef: { readonly columns: { readonly id: { readonly schema: { readonly Type: string } } } }
}

export interface EnsureClientOnlyRowStore<TEvent extends LiveStoreEvent.Input.Decoded> {
  readonly query: <TResult>(query: Queryable<TResult>) => TResult
  readonly commit: (options: { readonly label?: string }, event: TEvent) => void
}

export interface EnsureClientOnlyRowOptions<
  TTable extends EnsureClientOnlyRowTable,
  TDefault,
  TEvent extends LiveStoreEvent.Input.Decoded,
> {
  /** Store used for the passive read and explicit ensure commit. */
  readonly store: EnsureClientOnlyRowStore<TEvent>
  /** SQLite table that stores the client-only UI row. */
  readonly table: TTable
  /** Stable row id chosen by the caller for this initialization path. */
  readonly id: string
  /** Value passed to the caller-provided ensure event when the row does not exist. */
  readonly defaultValue: TDefault
  /** Optional commit label for LiveStore devtools/debugging. */
  readonly label?: string
  /** Creates the domain-specific client-only event that materializes the missing row. */
  readonly event: (args: {
    readonly id: string
    readonly defaultValue: TDefault
    readonly label: string
  }) => TEvent
}

/** Result of an ensure attempt, whether it reused or created the row. */
export interface EnsureClientOnlyRowResult<TTable extends EnsureClientOnlyRowTable> {
  /** SQLite table name for the ensured UI table. */
  readonly tableName: string
  /** Resolved row id that was checked or created. */
  readonly id: string
  /** True when this call committed the default row. */
  readonly created: boolean
  /** Current value of the ensured row. */
  readonly value: TTable['rowSchema']['Type']
}

/**
 * Ensures a client-only UI row exists before descendants read it.
 *
 * The helper owns the passive read, but callers still provide the explicit
 * client-only ensure event so the write remains visible at the app boundary.
 */
export const ensureClientOnlyRow = <
  TTable extends EnsureClientOnlyRowTable,
  TDefault,
  TEvent extends LiveStoreEvent.Input.Decoded,
>(
  options: EnsureClientOnlyRowOptions<TTable, TDefault, TEvent>,
): EnsureClientOnlyRowResult<TTable> => {
  const tableName = options.table.sqliteDef.name
  const readRow = () =>
    options.store.query(options.table.where({ id: options.id }).first({ behaviour: 'undefined' }))
  const existingRow = readRow()

  if (existingRow !== undefined) {
    return { tableName, id: options.id, created: false, value: existingRow }
  }

  const label = options.label ?? `${tableName}.ensure:${options.id}`
  options.store.commit({ label }, options.event({ id: options.id, defaultValue: options.defaultValue, label }))

  const createdRow = readRow()
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client-only row "${tableName}" with id "${options.id}"`)
  }

  return { tableName, id: options.id, created: true, value: createdRow }
}
