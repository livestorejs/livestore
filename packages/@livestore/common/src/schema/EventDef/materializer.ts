/**
 * Materializer System
 *
 * Materializers transform events into SQL mutations (INSERT, UPDATE, DELETE).
 * Every non-derived event must have a corresponding materializer that defines
 * how it affects the SQLite database state.
 *
 * Materializers are pure functions that receive the event arguments and return
 * SQL operations. They can also query current state when needed for complex
 * transformations.
 *
 * @example
 * ```ts
 * import { State } from '@livestore/livestore'
 *
 * const materializers = State.SQLite.materializers(events, {
 *   'v1.TodoCreated': ({ id, text }) =>
 *     tables.todos.insert({ id, text, completed: false }),
 *
 *   'v1.TodoCompleted': ({ id }) =>
 *     tables.todos.update({ completed: true }).where({ id }),
 *
 *   'v1.TodoDeleted': ({ id, deletedAt }) =>
 *     tables.todos.update({ deletedAt }).where({ id }),
 * })
 * ```
 * @module
 */

import type { SingleOrReadonlyArray } from '@livestore/utils'
import type { BindValues, ParamsObject } from '../../util.ts'
import type * as LiveStoreEvent from '../LiveStoreEvent/mod.ts'
import type { QueryBuilder } from '../state/sqlite/query-builder/mod.ts'
import type { EventDef } from './event-def.ts'
import type { EventDefFacts } from './facts.ts'

/**
 * Result type for materializer functions.
 *
 * Can be one of:
 * - A QueryBuilder operation (recommended for type safety)
 * - A raw SQL string (executed as-is with no bind values; use the object form
 *   or QueryBuilder if you need parameters)
 * - An object with SQL, bind values, and optional write table tracking
 *
 * @example Using raw SQL with parameters (object form required):
 * ```ts
 * 'v1.TodoRenamed': ({ id, text }) => ({
 *   sql: 'UPDATE todos SET text = :text WHERE id = :id',
 *   bindValues: { id, text },
 * })
 * ```
 */
export type MaterializerResult =
  | {
      sql: string
      bindValues: BindValues
      writeTables?: ReadonlySet<string>
    }
  | QueryBuilder.Any
  | string

/**
 * Function signature for querying current state within a materializer.
 *
 * Allows materializers to read existing data when computing mutations.
 * Can be called with either raw SQL or a type-safe QueryBuilder.
 *
 * @example
 * ```ts
 * 'v1.TodoUpdated': ({ id, text }, { query }) => {
 *   const existing = query(tables.todos.select().where({ id }).first())
 *   if (!existing) return []  // No-op if todo doesn't exist
 *   return tables.todos.update({ text }).where({ id })
 * }
 * ```
 */
export type MaterializerContextQuery = {
  /** Query with raw SQL and bind values. */
  (args: { query: string; bindValues: ParamsObject }): ReadonlyArray<unknown>
  /** Query with a type-safe QueryBuilder. */
  <TResult>(qb: QueryBuilder<TResult, any, any>): TResult
}

/**
 * Function type for transforming an event into database mutations.
 *
 * Materializers are the bridge between events and SQLite state. They receive
 * the decoded event arguments and return SQL operations to execute.
 *
 * @example
 * ```ts
 * const todoCreatedMaterializer: Materializer<typeof todoCreated> =
 *   ({ id, text }) => tables.todos.insert({ id, text, completed: false })
 * ```
 */
export type Materializer<TEventDef extends EventDef.AnyWithoutFn = EventDef.AnyWithoutFn> = (
  /** Decoded event arguments. */
  event: TEventDef['schema']['Type'],
  context: {
    /** Current facts state (experimental). */
    currentFacts: EventDefFacts
    /** The event definition being materialized. */
    eventDef: TEventDef
    /** Function to query current database state. */
    query: MaterializerContextQuery
    /** Full event metadata including clientId, sessionId, sequence numbers. */
    event: LiveStoreEvent.Client.Decoded
  },
) => SingleOrReadonlyArray<MaterializerResult>

/**
 * Type-safe wrapper for defining a single materializer.
 *
 * Useful when defining materializers separately from the `materializers()` builder.
 * The first argument provides type inference for the second.
 *
 * @example
 * ```ts
 * const todoCreatedHandler = defineMaterializer(
 *   events.todoCreated,
 *   ({ id, text }) => tables.todos.insert({ id, text, completed: false })
 * )
 * ```
 */
export const defineMaterializer = <TEventDef extends EventDef.AnyWithoutFn>(
  _eventDef: TEventDef,
  materializer: Materializer<TEventDef>,
): Materializer<TEventDef> => {
  return materializer
}

/**
 * Builder function for creating a type-safe materializer map.
 *
 * This is the primary way to define materializers in LiveStore. It ensures:
 * - Every non-derived event has a corresponding materializer
 * - Materializer argument types match their event schemas
 * - Derived events are excluded from the required handlers
 *
 * @example
 * ```ts
 * import { State } from '@livestore/livestore'
 *
 * const handlers = State.SQLite.materializers(events, {
 *   // Handler for each event - argument types are inferred
 *   'v1.TodoCreated': ({ id, text, completed }) =>
 *     tables.todos.insert({ id, text, completed }),
 *
 *   'v1.TodoUpdated': ({ id, text }) =>
 *     tables.todos.update({ text }).where({ id }),
 *
 *   // Can return multiple operations
 *   'v1.UserCreatedWithDefaults': ({ userId, name }) => [
 *     tables.users.insert({ id: userId, name }),
 *     tables.settings.insert({ userId, theme: 'light' }),
 *   ],
 *
 *   // Can query current state
 *   'v1.TodoToggled': ({ id }, { query }) => {
 *     const todo = query(tables.todos.select().where({ id }).first())
 *     return tables.todos.update({ completed: !todo?.completed }).where({ id })
 *   },
 * })
 * ```
 */
export const materializers = <TInputRecord extends Record<string, EventDef.AnyWithoutFn>>(
  _eventDefRecord: TInputRecord,
  handlers: {
    [TEventName in TInputRecord[keyof TInputRecord]['name'] as Extract<
      TInputRecord[keyof TInputRecord],
      { name: TEventName }
    >['options']['derived'] extends true
      ? never
      : TEventName]: Materializer<Extract<TInputRecord[keyof TInputRecord], { name: TEventName }>>
  },
) => {
  return handlers
}
