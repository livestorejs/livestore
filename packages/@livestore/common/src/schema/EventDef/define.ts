/**
 * Event Definition Functions
 *
 * This module provides functions for creating event definitions in LiveStore.
 * Events are the core unit of state change - all mutations to the database
 * happen through events that are committed to the eventlog.
 *
 * @example
 * ```ts
 * import { Events } from '@livestore/livestore'
 * import { Schema } from 'effect'
 *
 * // Define events for your application
 * export const events = {
 *   // Synced events are sent to the sync backend
 *   todoCreated: Events.synced({
 *     name: 'v1.TodoCreated',
 *     schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
 *   }),
 *
 *   // Client-only events stay local (useful for UI state)
 *   uiStateSet: Events.clientOnly({
 *     name: 'UiStateSet',
 *     schema: Schema.Struct({ selectedId: Schema.NullOr(Schema.String) }),
 *   }),
 * }
 * ```
 * @module
 */

import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { EventDef } from './event-def.ts'
import type { EventDefFactInput, EventDefFacts } from './facts.ts'

/** Options for defining an event. */
export type DefineEventOptions<TTo, TDerived extends boolean = false> = {
  /**
   * Callback defining fact constraints for this event.
   * @experimental This feature is not fully implemented yet.
   */
  facts?: (
    args: TTo,
    currentFacts: EventDefFacts,
  ) => {
    modify?: {
      /** Facts to set (create or update). */
      set?: Iterable<EventDefFactInput>
      /** Facts to unset (remove). */
      unset?: Iterable<EventDefFactInput>
    }
    /**
     * Facts that must exist for this event to be valid.
     * Used for history constraints and compaction rules.
     */
    require?: Iterable<EventDefFactInput>
  }

  /**
   * When true, the event is only synced within the same client's sessions
   * but never sent to the sync backend. Useful for UI state.
   * @default false
   */
  clientOnly?: boolean

  /**
   * When true, marks this as a derived event that cannot have materializers.
   * @default false
   */
  derived?: TDerived
}

/**
 * Creates an event definition with full control over all options.
 *
 * This is the low-level function for creating events. For most cases,
 * prefer using `synced()` or `clientOnly()` which provide simpler APIs.
 *
 * @example
 * ```ts
 * const customEvent = defineEvent({
 *   name: 'v1.CustomEvent',
 *   schema: Schema.Struct({ data: Schema.String }),
 *   clientOnly: false,
 *   derived: false,
 * })
 * ```
 */
export const defineEvent = <TName extends string, TType, TEncoded = TType, TDerived extends boolean = false>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & DefineEventOptions<TType, TDerived>,
): EventDef<TName, TType, TEncoded, TDerived> => {
  const { name, schema, ...options } = args

  const makePartialEvent = (args: TType) => {
    const res = Schema.validateEither(schema)(args)
    if (res._tag === 'Left') {
      shouldNeverHappen(`Invalid event args for event '${name}':`, res.left.message, '\n')
    }
    return { name: name, args }
  }

  Object.defineProperty(makePartialEvent, 'name', { value: name })
  Object.defineProperty(makePartialEvent, 'schema', { value: schema })
  Object.defineProperty(makePartialEvent, 'encoded', {
    value: (args: TEncoded) => ({ name: name, args }),
  })

  Object.defineProperty(makePartialEvent, 'options', {
    value: {
      clientOnly: options?.clientOnly ?? false,
      facts: options?.facts
        ? (args, currentFacts) => {
            const res = options.facts!(args, currentFacts)
            return {
              modify: {
                set: res.modify?.set ? new Set(res.modify.set) : new Set(),
                unset: res.modify?.unset ? new Set(res.modify.unset) : new Set(),
              },
              require: res.require ? new Set(res.require) : new Set(),
            }
          }
        : undefined,
      derived: options?.derived ?? false,
    } satisfies EventDef.Any['options'],
  })

  return makePartialEvent as EventDef<TName, TType, TEncoded, TDerived>
}

/**
 * Creates a synced event definition.
 *
 * Synced events are sent to the sync backend and distributed to all connected
 * clients. Use this for collaborative data that should be shared across users
 * and devices.
 *
 * Event names should be versioned (e.g., `v1.TodoCreated`) to support
 * schema evolution over time.
 *
 * @example
 * ```ts
 * import { Events } from '@livestore/livestore'
 * import { Schema } from 'effect'
 *
 * const todoCreated = Events.synced({
 *   name: 'v1.TodoCreated',
 *   schema: Schema.Struct({
 *     id: Schema.String,
 *     text: Schema.String,
 *     completed: Schema.Boolean,
 *   }),
 * })
 *
 * // Commit the event
 * store.commit(todoCreated({ id: 'abc', text: 'Buy milk', completed: false }))
 * ```
 */
export const synced = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineEventOptions<TType, false>, 'derived' | 'clientOnly'>,
): EventDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: false })

/**
 * Creates a client-only event definition.
 *
 * Client-only events are synced within the same client's sessions (e.g., across
 * browser tabs) but are never sent to the sync backend. Use this for local UI
 * state like selected items, filter settings, or draft content.
 *
 * Note: Client-only events still require materializers and are stored in the
 * local eventlog, they just don't participate in server-side sync.
 *
 * @example
 * ```ts
 * import { Events } from '@livestore/livestore'
 * import { Schema } from 'effect'
 *
 * const uiStateSet = Events.clientOnly({
 *   name: 'UiStateSet',
 *   schema: Schema.Struct({
 *     selectedTodoId: Schema.NullOr(Schema.String),
 *     filterMode: Schema.Literal('all', 'active', 'completed'),
 *   }),
 * })
 *
 * // Update local UI state
 * store.commit(uiStateSet({ selectedTodoId: 'abc', filterMode: 'active' }))
 * ```
 */
export const clientOnly = <TName extends string, TType, TEncoded = TType>(
  args: {
    name: TName
    schema: Schema.Schema<TType, TEncoded>
  } & Omit<DefineEventOptions<TType, false>, 'derived' | 'clientOnly'>,
): EventDef<TName, TType, TEncoded> => defineEvent({ ...args, clientOnly: true })
