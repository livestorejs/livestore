/**
 * Deprecation Annotations for Events
 *
 * This module provides utilities for marking event fields and entire events as deprecated.
 * When a deprecated field is used or a deprecated event is committed, a warning is logged.
 *
 * @example
 * ```ts
 * import { Events } from '@livestore/livestore'
 * import { Schema } from 'effect'
 * import { deprecated } from '@livestore/common/schema'
 *
 * // Field-level deprecation
 * const todoUpdated = Events.synced({
 *   name: 'v1.TodoUpdated',
 *   schema: Schema.Struct({
 *     id: Schema.String,
 *     title: Schema.optional(Schema.String).pipe(deprecated("Use 'text' instead")),
 *     text: Schema.optional(Schema.String),
 *   }),
 * })
 *
 * // Event-level deprecation
 * const todoRenamed = Events.synced({
 *   name: 'v1.TodoRenamed',
 *   schema: Schema.Struct({ id: Schema.String, name: Schema.String }),
 *   deprecated: "Use 'v1.TodoUpdated' instead",
 * })
 * ```
 * @module
 */

import type { Schema } from '@livestore/utils/effect'
import { Effect, Option, SchemaAST } from '@livestore/utils/effect'

import type { EventDef } from './event-def.ts'

/** Symbol used to mark schemas as deprecated. */
export const DeprecatedId = Symbol.for('livestore/schema/annotations/deprecated')

/**
 * Marks a schema field as deprecated with a reason message.
 * When an event is committed with a deprecated field that has a value,
 * a warning will be logged.
 *
 * Works with both Schema types and PropertySignatures (from Schema.optional).
 *
 * @param reason - Explanation of why this field is deprecated and what to use instead
 * @returns A function that adds the deprecation annotation to the schema
 *
 * @example
 * ```ts
 * const schema = Schema.Struct({
 *   oldField: Schema.optional(Schema.String).pipe(deprecated("Use 'newField' instead")),
 *   newField: Schema.optional(Schema.String),
 * })
 * ```
 */
export const deprecated =
  (reason: string) =>
  <T extends { annotations: (annotations: { readonly [DeprecatedId]?: string }) => T }>(schema: T): T =>
    schema.annotations({ [DeprecatedId]: reason })

/**
 * Checks if a schema has a deprecation annotation.
 *
 * @param schema - The schema to check
 * @returns The deprecation reason if deprecated, None otherwise
 */
export const getDeprecatedReason = <A, I, R>(schema: Schema.Schema<A, I, R>): Option.Option<string> =>
  SchemaAST.getAnnotation<string>(DeprecatedId)(schema.ast)

/**
 * Checks if a schema is deprecated.
 *
 * @param schema - The schema to check
 * @returns true if the schema is deprecated
 */
export const isDeprecated = <A, I, R>(schema: Schema.Schema<A, I, R>): boolean =>
  Option.isSome(getDeprecatedReason(schema))

/**
 * Finds deprecated fields with values in the given event arguments.
 * This walks through a Struct schema and checks each property for deprecation.
 *
 * @param schema - The event schema (expected to be a Struct)
 * @param args - The event arguments
 * @returns Array of objects containing field name and deprecation reason
 */
export const findDeprecatedFieldsWithValues = (
  schema: Schema.Schema.All,
  args: Record<string, unknown>,
): Array<{ field: string; reason: string }> => {
  const result: Array<{ field: string; reason: string }> = []
  const ast = schema.ast

  // Handle TypeLiteral (Struct) schemas
  if (ast._tag === 'TypeLiteral') {
    for (const prop of ast.propertySignatures) {
      const fieldName = String(prop.name)
      const fieldValue = args[fieldName]

      // Only check fields that have a value (not undefined)
      if (fieldValue !== undefined) {
        // Check deprecation on the property signature itself (for Schema.optional(...).pipe(deprecated(...)))
        const propAnnotations = prop.annotations as Record<symbol, unknown> | undefined
        const deprecationReason = propAnnotations?.[DeprecatedId] as string | undefined

        // Also check deprecation on the type (for direct field deprecation)
        const typeDeprecation = SchemaAST.getAnnotation<string>(DeprecatedId)(prop.type)

        const reason = deprecationReason ?? (Option.isSome(typeDeprecation) ? typeDeprecation.value : undefined)
        if (reason !== undefined) {
          result.push({ field: fieldName, reason })
        }
      }
    }
  }

  return result
}

/** Set of event names that have already logged deprecation warnings. */
const warnedDeprecatedEvents = new Set<string>()

/** Map of event+field combinations that have already logged deprecation warnings. */
const warnedDeprecatedFields = new Set<string>()

/**
 * Logs deprecation warnings for an event using Effect.logWarning.
 * Checks both event-level and field-level deprecation, with deduplication.
 *
 * @param eventDef - The event definition to check
 * @param args - The event arguments
 * @returns An Effect that logs warnings for any deprecations found
 */
export const logDeprecationWarnings = (
  eventDef: EventDef.AnyWithoutFn,
  args: Record<string, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const eventName = eventDef.name

    // Check for event-level deprecation
    const eventDeprecation = eventDef.options.deprecated
    if (eventDeprecation !== undefined && !warnedDeprecatedEvents.has(eventName)) {
      warnedDeprecatedEvents.add(eventName)
      yield* Effect.logWarning('@livestore/schema:deprecated-event', {
        event: eventName,
        reason: eventDeprecation,
      })
    }

    // Check for deprecated fields with values
    const deprecatedFields = findDeprecatedFieldsWithValues(eventDef.schema, args)
    for (const { field, reason } of deprecatedFields) {
      const key = `${eventName}:${field}`
      if (!warnedDeprecatedFields.has(key)) {
        warnedDeprecatedFields.add(key)
        yield* Effect.logWarning('@livestore/schema:deprecated-field', {
          event: eventName,
          field,
          reason,
        })
      }
    }
  })

/**
 * Resets the deprecation warning state. Useful for testing.
 */
export const resetDeprecationWarnings = (): void => {
  warnedDeprecatedEvents.clear()
  warnedDeprecatedFields.clear()
}
