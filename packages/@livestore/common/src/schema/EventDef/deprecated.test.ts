import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { Effect, Logger, Schema } from '@livestore/utils/effect'

import { synced } from './define.ts'
import {
  deprecated,
  findDeprecatedFieldsWithValues,
  getDeprecatedReason,
  isDeprecated,
  logDeprecationWarnings,
  resetDeprecationWarnings,
} from './deprecated.ts'

describe('deprecated annotations', () => {
  test('adds deprecation annotation to schema', () => {
    const schema = Schema.String.pipe(deprecated('Use newField instead'))
    expect(isDeprecated(schema)).toBe(true)
    expect(getDeprecatedReason(schema)._tag).toBe('Some')
  })

  test('works with optional fields in Struct', () => {
    const struct = Schema.Struct({
      oldField: Schema.optional(Schema.String).pipe(deprecated('Legacy')),
    })
    expect(findDeprecatedFieldsWithValues(struct, { oldField: 'x' })).toEqual([{ field: 'oldField', reason: 'Legacy' }])
  })

  test('non-deprecated schemas return false', () => {
    expect(isDeprecated(Schema.String)).toBe(false)
  })

  test('ignores deprecated fields without values', () => {
    const schema = Schema.Struct({
      id: Schema.String,
      old: Schema.optional(Schema.String).pipe(deprecated('x')),
    })
    expect(findDeprecatedFieldsWithValues(schema, { id: '1' })).toEqual([])
  })

  test('finds multiple deprecated fields', () => {
    const schema = Schema.Struct({
      a: Schema.optional(Schema.String).pipe(deprecated('A')),
      b: Schema.optional(Schema.String).pipe(deprecated('B')),
    })
    const result = findDeprecatedFieldsWithValues(schema, { a: '1', b: '2' })
    expect(result).toHaveLength(2)
  })
})

describe('logDeprecationWarnings', () => {
  let logs: unknown[][]

  beforeEach(() => {
    resetDeprecationWarnings()
    logs = []
  })

  afterEach(() => resetDeprecationWarnings())

  const run = (effect: Effect.Effect<void>) =>
    Effect.runSync(
      effect.pipe(
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            Logger.make(({ message }) => logs.push(message as unknown[])),
          ),
        ),
      ),
    )

  test('logs event deprecation warning', () => {
    const event = synced({ name: 'Old', schema: Schema.Struct({ id: Schema.String }), deprecated: 'Use New' })
    run(logDeprecationWarnings(event, { id: '1' }))
    expect(logs).toEqual([['@livestore/schema:deprecated-event', { event: 'Old', reason: 'Use New' }]])
  })

  test('logs field deprecation warning', () => {
    const event = synced({
      name: 'Ev',
      schema: Schema.Struct({ old: Schema.optional(Schema.String).pipe(deprecated('Use new')) }),
    })
    run(logDeprecationWarnings(event, { old: 'x' }))
    expect(logs).toEqual([['@livestore/schema:deprecated-field', { event: 'Ev', field: 'old', reason: 'Use new' }]])
  })

  test('deduplicates event warnings', () => {
    const event = synced({ name: 'Dup', schema: Schema.Struct({ id: Schema.String }), deprecated: 'x' })
    run(logDeprecationWarnings(event, { id: '1' }))
    run(logDeprecationWarnings(event, { id: '2' }))
    expect(logs).toHaveLength(1)
  })

  test('deduplicates field warnings', () => {
    const event = synced({
      name: 'DupField',
      schema: Schema.Struct({ old: Schema.optional(Schema.String).pipe(deprecated('x')) }),
    })
    run(logDeprecationWarnings(event, { old: 'a' }))
    run(logDeprecationWarnings(event, { old: 'b' }))
    expect(logs).toHaveLength(1)
  })

  test('no warning for non-deprecated event', () => {
    const event = synced({ name: 'Normal', schema: Schema.Struct({ id: Schema.String }) })
    run(logDeprecationWarnings(event, { id: '1' }))
    expect(logs).toHaveLength(0)
  })

  test('no warning when deprecated field is undefined', () => {
    const event = synced({
      name: 'Unused',
      schema: Schema.Struct({ old: Schema.optional(Schema.String).pipe(deprecated('x')) }),
    })
    run(logDeprecationWarnings(event, {}))
    expect(logs).toHaveLength(0)
  })

  test('logs both event and field warnings', () => {
    const event = synced({
      name: 'Both',
      schema: Schema.Struct({ old: Schema.optional(Schema.String).pipe(deprecated('F')) }),
      deprecated: 'E',
    })
    run(logDeprecationWarnings(event, { old: 'x' }))
    expect(logs).toHaveLength(2)
  })
})
