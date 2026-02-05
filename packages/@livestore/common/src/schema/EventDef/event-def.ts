import type { Schema } from '@livestore/utils/effect'

import type { FactsCallback } from './facts.ts'

/**
 * Core type representing an event definition in LiveStore.
 *
 * An EventDef defines the structure and behavior of an event type, including:
 * - A unique name identifying the event type (conventionally versioned, e.g., `v1.TodoCreated`)
 * - A schema for validating and encoding/decoding event arguments
 * - Options controlling sync behavior and constraints
 *
 * EventDefs are callable - invoking them creates a partial event object suitable for `store.commit()`.
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
 *   }),
 * })
 *
 * // Use the EventDef as a constructor
 * store.commit(todoCreated({ id: 'abc', text: 'Buy milk' }))
 * ```
 */
export type EventDef<TName extends string, TType, TEncoded = TType, TDerived extends boolean = false> = {
  /** Unique identifier for this event type. Conventionally versioned (e.g., `v1.TodoCreated`). */
  name: TName

  /** Effect Schema used for validating and encoding/decoding event arguments. */
  schema: Schema.Schema<TType, TEncoded>

  options: {
    /**
     * When true, the event is only synced within the same client's sessions (e.g., across tabs)
     * but never sent to the sync backend. Useful for UI state like selected items or filters.
     */
    clientOnly: boolean

    /**
     * Callback defining fact constraints for this event.
     * @experimental This feature is not fully implemented yet.
     */
    facts: FactsCallback<TType> | undefined

    /** Whether this is a derived event. Derived events cannot have materializers. */
    derived: TDerived

    /**
     * Deprecation reason for this event. When set, a warning is logged at commit time.
     */
    deprecated: string | undefined
  }

  /**
   * Callable signature - creates a partial event with decoded arguments.
   * The returned object can be passed directly to `store.commit()`.
   */
  (args: TType): {
    name: TName
    args: TType
  }

  /**
   * Creates a partial event with pre-encoded arguments.
   * Useful when working with already-serialized data.
   */
  encoded: (args: TEncoded) => {
    name: TName
    args: TEncoded
  }

  /** Type helper for accessing the event's shape with name and decoded args. */
  readonly Event: {
    name: TName
    args: TType
  }
}

export namespace EventDef {
  /**
   * Wildcard type matching any EventDef regardless of type parameters.
   * Used as a type constraint in generic functions and collections.
   */
  export type Any = EventDef<string, any, any, boolean>

  /**
   * EventDef without the callable function signature.
   * Used in contexts where only the metadata (name, schema, options) is needed,
   * such as materializer definitions.
   */
  export type AnyWithoutFn = Pick<Any, 'name' | 'schema' | 'options'>
}

/**
 * Container holding a Map of event definitions keyed by name.
 * Used internally by LiveStoreSchema.
 */
export type EventDefMap = {
  map: Map<string, EventDef.Any>
}

/**
 * Plain object record of event definitions keyed by name.
 * This is the typical shape when defining events in user code.
 *
 * @example
 * ```ts
 * const events = {
 *   todoCreated: Events.synced({ name: 'v1.TodoCreated', schema: ... }),
 *   todoDeleted: Events.synced({ name: 'v1.TodoDeleted', schema: ... }),
 * } satisfies EventDefRecord
 * ```
 */
export type EventDefRecord = {
  [name: string]: EventDef.Any
}
