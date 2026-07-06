export interface EnsureClientOnlyRowOptions<TRow, TDefault> {
  /** SQLite table name used for labels and errors. */
  readonly tableName: string
  /** Stable row id chosen by the caller for this initialization path. */
  readonly id: string
  /** Value passed to the caller-provided ensure event when the row does not exist. */
  readonly default: TDefault
  /** Optional commit label for LiveStore devtools/debugging. */
  readonly label?: string
  /** Synchronously reads the row without creating it. */
  readonly read: (id: string) => TRow | undefined
  /** Commits the domain-specific client-only event that creates the missing row. */
  readonly commitEnsure: (args: { readonly id: string; readonly default: TDefault; readonly label: string }) => void
}

/** Result of an ensure attempt, whether it reused or created the row. */
export interface EnsureClientOnlyRowResult<TRow> {
  /** SQLite table name for the ensured UI table. */
  readonly tableName: string
  /** Resolved row id that was checked or created. */
  readonly id: string
  /** True when this call committed the default row. */
  readonly created: boolean
  /** Current value of the ensured row. */
  readonly value: TRow
}

/**
 * Ensures a client-only UI row exists before descendants read it.
 *
 * This helper intentionally does not define tables, events, or materializers.
 * Callers provide the passive read and explicit client-only ensure event so the
 * schema remains visible at the app boundary.
 */
export const ensureClientOnlyRow = <TRow, TDefault>(
  options: EnsureClientOnlyRowOptions<TRow, TDefault>,
): EnsureClientOnlyRowResult<TRow> => {
  const existingRow = options.read(options.id)

  if (existingRow !== undefined) {
    return { tableName: options.tableName, id: options.id, created: false, value: existingRow }
  }

  const label = options.label ?? `${options.tableName}.ensure:${options.id}`
  options.commitEnsure({ id: options.id, default: options.default, label })

  const createdRow = options.read(options.id)
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client-only row "${options.tableName}" with id "${options.id}"`)
  }

  return { tableName: options.tableName, id: options.id, created: true, value: createdRow }
}
