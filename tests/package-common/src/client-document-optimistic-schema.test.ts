import { State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

describe('Client Document Optimistic Schema', () => {
  describe('Full Set Operations', () => {
    const valueSchema = Schema.Struct({
      name: Schema.String,
      age: Schema.Number,
      email: Schema.String,
    })

    const defaultValue = { name: 'User', age: 25, email: 'user@example.com' }

    const optimisticSchema = State.SQLite.createOptimisticEventSchema({
      valueSchema,
      defaultValue,
      partialSet: false,
    })

    it('accepts current schema events', () => {
      const current = { name: 'Alice', age: 30, email: 'alice@example.com' }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(current)
      expect(decoded).toEqual(current)
    })

    it('adds missing required fields from defaults', () => {
      const oldEvent = { name: 'Bob', age: 35 } // Missing email
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(oldEvent)
      expect(decoded).toEqual({ name: 'Bob', age: 35, email: 'user@example.com' })
    })

    it('drops removed fields', () => {
      const oldEvent = { name: 'Charlie', age: 40, email: 'charlie@example.com', oldField: 'data' }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(oldEvent)
      expect(decoded).toEqual({ name: 'Charlie', age: 40, email: 'charlie@example.com' })
    })

    it('uses defaults for type mismatches', () => {
      const oldEvent = { name: 'Dave', age: 'thirty', email: 'dave@example.com' } // Wrong type for age
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(oldEvent)
      expect(decoded).toEqual(defaultValue) // Falls back to full defaults
    })

    it('handles non-object events', () => {
      expect(Schema.decodeUnknownSync(optimisticSchema)(null)).toEqual(defaultValue)
      expect(Schema.decodeUnknownSync(optimisticSchema)('string')).toEqual(defaultValue)
      expect(Schema.decodeUnknownSync(optimisticSchema)(123)).toEqual(defaultValue)
    })
  })

  describe('Partial Set Operations', () => {
    const valueSchema = Schema.Struct({
      field1: Schema.String,
      field2: Schema.Number,
    })

    const defaultValue = { field1: 'default1', field2: 0 }

    const optimisticSchema = State.SQLite.createOptimisticEventSchema({
      valueSchema,
      defaultValue,
      partialSet: true,
    })

    it('accepts partial updates', () => {
      const partial = { field1: 'updated' }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(partial)
      expect(decoded).toEqual({ field1: 'updated' })
    })

    it('filters out unknown fields', () => {
      const oldPartial = { field1: 'updated', unknownField: 'data' }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(oldPartial)
      expect(decoded).toEqual({ field1: 'updated' })
    })

    it('returns empty object for incompatible partials', () => {
      const incompatible = { field2: 'not-a-number' }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(incompatible)
      expect(decoded).toEqual({})
    })

    it('handles multiple fields with mixed compatibility', () => {
      const mixed = { field1: 'valid', field2: 42 }
      const decoded = Schema.decodeUnknownSync(optimisticSchema)(mixed)
      expect(decoded).toEqual({ field1: 'valid', field2: 42 })
    })

    it('handles non-object values', () => {
      expect(Schema.decodeUnknownSync(optimisticSchema)(null)).toEqual({})
      expect(Schema.decodeUnknownSync(optimisticSchema)(undefined)).toEqual({})
      expect(Schema.decodeUnknownSync(optimisticSchema)([])).toEqual({})
    })
  })
})
