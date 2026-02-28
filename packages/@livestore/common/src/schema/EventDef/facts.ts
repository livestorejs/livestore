/**
 * Facts System for Event Constraints (Experimental)
 *
 * The facts system enables defining constraints and dependencies between events.
 * Facts are key-value pairs that events can read, set, or require, allowing
 * LiveStore to understand event relationships for:
 * - History constraints (ordering requirements)
 * - Event compaction (which events can be safely merged)
 * - Conflict detection during sync
 *
 * @experimental This system is not fully implemented yet.
 *
 * @example
 * ```ts
 * const facts = defineFacts({
 *   todoExists: (id: string) => [`todo:${id}`, true],
 *   userOwns: (userId: string, todoId: string) => [`owns:${userId}:${todoId}`, true],
 * })
 *
 * const todoCreated = Events.synced({
 *   name: 'v1.TodoCreated',
 *   schema: Schema.Struct({ id: Schema.String, userId: Schema.String }),
 *   facts: ({ id, userId }) => ({
 *     modify: { set: [facts.todoExists(id), facts.userOwns(userId, id)] },
 *     require: [],
 *   }),
 * })
 * ```
 * @module
 */

/** String key identifying a fact (e.g., `"todo:abc123"` or `"user:owner:xyz"`). */
export type EventDefKey = string

/** String identifier for a fact type. */
export type EventDefFact = string

/** Immutable map of fact keys to their current values. */
export type EventDefFacts = ReadonlyMap<string, any>

/**
 * Groups of facts that an event interacts with.
 * Used internally to track how events modify and depend on facts.
 */
export type EventDefFactsGroup = {
  /** Facts this event sets to a new value. */
  modifySet: EventDefFacts

  /** Facts this event removes/unsets. */
  modifyUnset: EventDefFacts

  /**
   * Facts this event requires to exist with specific values.
   * Events on independent dependency branches are commutative,
   * which can facilitate more prioritized syncing.
   */
  depRequire: EventDefFacts

  /** Facts this event reads (but doesn't require). */
  depRead: EventDefFacts
}

/** Mutable snapshot of facts state at a point in time. */
export type EventDefFactsSnapshot = Map<string, any>

/**
 * Input format for specifying a fact.
 * Either a simple key string (value defaults to `true`) or a `[key, value]` tuple.
 *
 * @example
 * ```ts
 * // Simple key (value = true)
 * const fact1: EventDefFactInput = 'todo:abc123'
 *
 * // Key-value tuple
 * const fact2: EventDefFactInput = ['todo:abc123', { status: 'active' }]
 * ```
 */
export type EventDefFactInput = string | readonly [string, any]

/**
 * Callback function that defines how an event interacts with the facts system.
 * Called during event processing to determine fact constraints.
 *
 * @example
 * ```ts
 * const factsCallback: FactsCallback<{ id: string }> = (args, currentFacts) => ({
 *   modify: {
 *     set: [`item:${args.id}`],  // Create/update this fact
 *     unset: [],                  // No facts to remove
 *   },
 *   require: currentFacts.has('initialized') ? [] : ['initialized'],
 * })
 * ```
 */
export type FactsCallback<TTo> = (
  args: TTo,
  currentFacts: EventDefFacts,
) => {
  modify: {
    /** Facts to set (create or update). */
    set: Iterable<EventDefFactInput>
    /** Facts to unset (remove). */
    unset: Iterable<EventDefFactInput>
  }
  /** Facts that must exist with specific values for this event to be valid. */
  require: Iterable<EventDefFactInput>
}

/**
 * Helper to define a typed record of fact constructors.
 * Returns the input unchanged but provides type inference.
 *
 * @example
 * ```ts
 * const facts = defineFacts({
 *   // Simple fact (value = true)
 *   initialized: 'system:initialized',
 *
 *   // Parameterized fact constructor
 *   todoExists: (id: string) => [`todo:${id}`, true] as const,
 *
 *   // Fact with complex value
 *   todoStatus: (id: string, status: string) => [`todo:${id}:status`, status] as const,
 * })
 *
 * // Usage
 * facts.todoExists('abc')  // => ['todo:abc', true]
 * ```
 */
export const defineFacts = <
  TRecord extends Record<string, EventDefFactInput | ((...args: any[]) => EventDefFactInput)>,
>(
  record: TRecord,
): TRecord => record
