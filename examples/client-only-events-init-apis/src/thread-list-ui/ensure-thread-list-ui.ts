import { type Store } from '@livestore/livestore'

import { ensureClientOnlyRow, type EnsureClientOnlyRowResult } from '../ensure-client-row/ensure-client-only-row.ts'
import {
  useEnsureClientOnlyRow,
  type UseEnsureClientOnlyRowOptions,
  type UseEnsureClientOnlyRowResult,
} from '../ensure-client-row/use-ensure-client-only-row.ts'
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

export type EnsureThreadListUiResult = EnsureClientOnlyRowResult<ThreadListUiRow>
export type UseEnsureThreadListUiOptions = UseEnsureClientOnlyRowOptions
export type UseEnsureThreadListUiResult = UseEnsureClientOnlyRowResult<EnsureThreadListUiResult>

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
): EnsureThreadListUiResult =>
  ensureClientOnlyRow({
    tableName: tables.threadListUi.sqliteDef.name,
    id: spec.id,
    default: spec.default,
    ...(spec.label === undefined ? {} : { label: spec.label }),
    read: (id) => selectThreadListUiRow(store, id),
    commitEnsure: ({ id, default: defaultValue, label }) => {
      store.commit({ label }, events.threadListUiEnsured({ id, ...defaultValue }))
    },
  })

/** Reads the current row synchronously without creating a React subscription. */
const selectThreadListUiRow = (store: Store<typeof schema>, id: string): ThreadListUiRow | undefined =>
  store.query(tables.threadListUi.where({ id }).first({ behaviour: 'undefined' }))

/** Example-local hook for ensuring one client-only UI row before descendants read it. */
export function useEnsureThreadListUi(
  store: Store<typeof schema>,
  row: EnsureThreadListUiSpec,
  options: UseEnsureThreadListUiOptions = {},
): UseEnsureThreadListUiResult {
  return useEnsureClientOnlyRow(() => ensureThreadListUi(store, row), options)
}
