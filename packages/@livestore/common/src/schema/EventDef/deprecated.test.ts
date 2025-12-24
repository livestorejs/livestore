import { Schema } from '@livestore/utils/effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { synced } from './define.ts'
import {
  DeprecatedId,
  deprecated,
  findDeprecatedFieldsWithValues,
  getDeprecatedReason,
  isDeprecated,
  resetDeprecationWarnings,
} from './deprecated.ts'

describe('deprecated annotations', () => {
  describe('deprecated helper', () => {
    test('should add deprecation annotation to schema', () => {
      const schema = Schema.String.pipe(deprecated('Use newField instead'))

      expect(isDeprecated(schema)).toBe(true)
      expect(getDeprecatedReason(schema)).toMatchObject({ _tag: 'Some', value: 'Use newField instead' })
    })

    test('should work with optional fields in a Struct', () => {
      const struct = Schema.Struct({
        oldField: Schema.optional(Schema.String).pipe(deprecated('Legacy field')),
      })

      // The deprecation annotation is on the property signature, not a Schema,
      // so we test it through findDeprecatedFieldsWithValues
      const result = findDeprecatedFieldsWithValues(struct, { oldField: 'value' })
      expect(result).toEqual([{ field: 'oldField', reason: 'Legacy field' }])
    })

    test('should preserve the schema annotation symbol', () => {
      const schema = Schema.String.pipe(deprecated('Test reason'))
      const annotations = schema.ast.annotations as Record<symbol, unknown>

      expect(annotations[DeprecatedId]).toBe('Test reason')
    })
  })

  describe('isDeprecated', () => {
    test('should return true for deprecated schemas', () => {
      const schema = Schema.String.pipe(deprecated('Old field'))
      expect(isDeprecated(schema)).toBe(true)
    })

    test('should return false for non-deprecated schemas', () => {
      expect(isDeprecated(Schema.String)).toBe(false)
      expect(isDeprecated(Schema.Number)).toBe(false)
    })
  })

  describe('findDeprecatedFieldsWithValues', () => {
    test('should find deprecated fields that have values', () => {
      const schema = Schema.Struct({
        id: Schema.String,
        oldTitle: Schema.optional(Schema.String).pipe(deprecated("Use 'title' instead")),
        title: Schema.optional(Schema.String),
      })

      const result = findDeprecatedFieldsWithValues(schema, {
        id: 'test-id',
        oldTitle: 'Some old title',
        title: 'New title',
      })

      expect(result).toEqual([{ field: 'oldTitle', reason: "Use 'title' instead" }])
    })

    test('should not include deprecated fields that are undefined', () => {
      const schema = Schema.Struct({
        id: Schema.String,
        oldField: Schema.optional(Schema.String).pipe(deprecated('Deprecated')),
      })

      const result = findDeprecatedFieldsWithValues(schema, {
        id: 'test-id',
        // oldField is undefined (not provided)
      })

      expect(result).toEqual([])
    })

    test('should find multiple deprecated fields', () => {
      const schema = Schema.Struct({
        id: Schema.String,
        oldA: Schema.optional(Schema.String).pipe(deprecated('Use newA')),
        oldB: Schema.optional(Schema.Number).pipe(deprecated('Use newB')),
        newA: Schema.optional(Schema.String),
        newB: Schema.optional(Schema.Number),
      })

      const result = findDeprecatedFieldsWithValues(schema, {
        id: 'test-id',
        oldA: 'value A',
        oldB: 42,
      })

      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ field: 'oldA', reason: 'Use newA' })
      expect(result).toContainEqual({ field: 'oldB', reason: 'Use newB' })
    })

    test('should handle non-struct schemas gracefully', () => {
      const schema = Schema.String
      const result = findDeprecatedFieldsWithValues(schema, {})
      expect(result).toEqual([])
    })
  })
})

describe('deprecation warnings', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetDeprecationWarnings()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('event-level deprecation', () => {
    test('should log warning when deprecated event is created', () => {
      const deprecatedEvent = synced({
        name: 'v1.OldEvent',
        schema: Schema.Struct({ id: Schema.String }),
        deprecated: "Use 'v2.NewEvent' instead",
      })

      deprecatedEvent({ id: 'test-id' })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[LiveStore] Deprecated event 'v1.OldEvent': Use 'v2.NewEvent' instead",
      )
    })

    test('should only log warning once per event (deduplication)', () => {
      const deprecatedEvent = synced({
        name: 'v1.DedupeEvent',
        schema: Schema.Struct({ id: Schema.String }),
        deprecated: 'Deprecated',
      })

      deprecatedEvent({ id: '1' })
      deprecatedEvent({ id: '2' })
      deprecatedEvent({ id: '3' })

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    })

    test('should not log warning for non-deprecated events', () => {
      const normalEvent = synced({
        name: 'v1.NormalEvent',
        schema: Schema.Struct({ id: Schema.String }),
      })

      normalEvent({ id: 'test-id' })

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('field-level deprecation', () => {
    test('should log warning when deprecated field has value', () => {
      const eventWithDeprecatedField = synced({
        name: 'v1.EventWithOldField',
        schema: Schema.Struct({
          id: Schema.String,
          oldTitle: Schema.optional(Schema.String).pipe(deprecated("Use 'title' instead")),
          title: Schema.optional(Schema.String),
        }),
      })

      eventWithDeprecatedField({ id: 'test-id', oldTitle: 'Old value' })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[LiveStore] Deprecated field 'oldTitle' in event 'v1.EventWithOldField': Use 'title' instead",
      )
    })

    test('should not log warning when deprecated field is undefined', () => {
      const eventWithDeprecatedField = synced({
        name: 'v1.EventWithUnusedOldField',
        schema: Schema.Struct({
          id: Schema.String,
          oldField: Schema.optional(Schema.String).pipe(deprecated('Deprecated')),
        }),
      })

      eventWithDeprecatedField({ id: 'test-id' })

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    test('should only log field warning once (deduplication)', () => {
      const eventWithDeprecatedField = synced({
        name: 'v1.EventWithDedupeField',
        schema: Schema.Struct({
          id: Schema.String,
          oldField: Schema.optional(Schema.String).pipe(deprecated('Old')),
        }),
      })

      eventWithDeprecatedField({ id: '1', oldField: 'a' })
      eventWithDeprecatedField({ id: '2', oldField: 'b' })
      eventWithDeprecatedField({ id: '3', oldField: 'c' })

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    })

    test('should log warnings for multiple deprecated fields', () => {
      const eventWithMultipleDeprecated = synced({
        name: 'v1.MultiDeprecated',
        schema: Schema.Struct({
          id: Schema.String,
          oldA: Schema.optional(Schema.String).pipe(deprecated('Use newA')),
          oldB: Schema.optional(Schema.String).pipe(deprecated('Use newB')),
        }),
      })

      eventWithMultipleDeprecated({ id: 'test', oldA: 'a', oldB: 'b' })

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[LiveStore] Deprecated field 'oldA' in event 'v1.MultiDeprecated': Use newA",
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[LiveStore] Deprecated field 'oldB' in event 'v1.MultiDeprecated': Use newB",
      )
    })
  })

  describe('combined event and field deprecation', () => {
    test('should log both event and field warnings', () => {
      const fullyDeprecatedEvent = synced({
        name: 'v1.FullyDeprecated',
        schema: Schema.Struct({
          id: Schema.String,
          oldField: Schema.optional(Schema.String).pipe(deprecated('Field deprecated')),
        }),
        deprecated: 'Event deprecated',
      })

      fullyDeprecatedEvent({ id: 'test', oldField: 'value' })

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
      expect(consoleWarnSpy).toHaveBeenCalledWith("[LiveStore] Deprecated event 'v1.FullyDeprecated': Event deprecated")
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[LiveStore] Deprecated field 'oldField' in event 'v1.FullyDeprecated': Field deprecated",
      )
    })
  })
})
