/**
 * SessionIdSymbol is a user-facing placeholder for "the current client session".
 * User code can keep using the same event/query object across sessions, while the
 * storage and eventlog layers require concrete string ids. Resolving the symbol at
 * those boundaries preserves the symbolic API without mutating caller-owned values.
 *
 * @module
 */
import { Predicate } from '@livestore/utils/effect'

import type { Bindable, SqlValue } from './util.ts'

/**
 * Can be used in queries to refer to the current session id.
 * Will be replaced with the actual session id at runtime.
 *
 * In client document table:
 * ```ts
 * const uiState = State.SQLite.clientDocument({
 *   name: 'ui_state',
 *   schema: Schema.Struct({
 *     theme: Schema.Literals(['dark', 'light', 'system']),
 *     user: Schema.String,
 *     showToolbar: Schema.Boolean,
 *   }),
 *   default: { value: defaultFrontendState, id: SessionIdSymbol },
 * })
 * ```
 *
 * Or in a client document query:
 * ```ts
 * const query$ = queryDb(tables.uiState.get(SessionIdSymbol))
 * ```
 */
export const SessionIdSymbol = Symbol.for('@livestore/session-id')
export type SessionIdSymbol = typeof SessionIdSymbol

export type BindableWithSessionIdSymbol =
  | ReadonlyArray<SqlValue | SessionIdSymbol>
  | Record<string, SqlValue | SessionIdSymbol>

export const resolveSessionIdSymbolInBindValues = (
  bindValues: BindableWithSessionIdSymbol,
  sessionId: string,
): Bindable => {
  return Predicate.isRecord(bindValues) === true
    ? (Object.fromEntries(
        Object.entries(bindValues).map(([key, value]) => [key, value === SessionIdSymbol ? sessionId : value]),
      ) as Record<string, SqlValue>)
    : bindValues.map((value) => (value === SessionIdSymbol ? sessionId : value))
}

export const resolveSessionIdSymbolInEventArgs = (args: unknown, sessionId: string): unknown => {
  if (Predicate.hasProperty(args, 'id') === false) {
    return args
  }

  return args.id === SessionIdSymbol ? { ...args, id: sessionId } : args
}
