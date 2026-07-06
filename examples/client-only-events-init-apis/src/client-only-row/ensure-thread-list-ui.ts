import { type Store } from '@livestore/livestore'

import { events, schema, tables } from '../schema.ts'

export type ThreadListUiRow = typeof tables.threadListUi.Type
export type ThreadListUiDefault = Omit<ThreadListUiRow, 'id'>

/** Input for ensuring one explicitly identified client-only UI row. */
export interface EnsureThreadListUiSpec {
  /** Stable row id chosen by the caller for this initialization path. */
  readonly id: string
  /** Value committed when the row does not exist. */
  readonly default: ThreadListUiDefault
  /** Optional commit label for LiveStore devtools/debugging. */
  readonly label?: string
}

/** Result of an ensure attempt, whether it reused or created the row. */
export interface EnsureThreadListUiResult {
  /** SQLite table name for the ensured UI table. */
  readonly tableName: string
  /** Resolved row id that was checked or created. */
  readonly id: string
  /** True when this call committed the default row. */
  readonly created: boolean
  /** Current value of the ensured row. */
  readonly value: ThreadListUiRow
}

/**
 * Ensures a client-only UI row exists before descendants read it.
 *
 * This helper is intentionally synchronous: once the LiveStore instance is available,
 * reads and commits can run during boot, a route loader, or render.
 *
 * @returns The active row value and whether this call created it.
 */
export const ensureThreadListUi = (
  store: Store<typeof schema>,
  spec: EnsureThreadListUiSpec,
): EnsureThreadListUiResult => {
  const tableName = tables.threadListUi.sqliteDef.name
  const existingRow = selectThreadListUiRow(store, spec.id)

  if (existingRow !== undefined) {
    return { tableName, id: spec.id, created: false, value: existingRow }
  }

  store.commit(
    { label: spec.label ?? `${tableName}.ensure:${spec.id}` },
    events.threadListUiEnsured({ id: spec.id, ...spec.default }),
  )

  const createdRow = selectThreadListUiRow(store, spec.id)
  if (createdRow === undefined) {
    throw new Error(`Failed to ensure client-only row "${tableName}" with id "${spec.id}"`)
  }

  return { tableName, id: spec.id, created: true, value: createdRow }
}

/** Reads the current row synchronously without creating a React subscription. */
const selectThreadListUiRow = (store: Store<typeof schema>, id: string): ThreadListUiRow | undefined =>
  store.query(tables.threadListUi.where({ id }).first({ behaviour: 'undefined' }))
