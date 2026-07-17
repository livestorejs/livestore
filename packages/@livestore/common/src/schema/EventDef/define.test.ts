import { describe, expect, test } from 'vitest'

import { Schema } from '@livestore/utils/effect'

import { synced } from './define.ts'

describe('synced event wire schema', () => {
  const occurredAt = new Date('2026-07-17T10:15:30.000Z')
  const event = synced({
    name: 'v1.Occurred',
    schema: Schema.Struct({
      occurredAt: Schema.DateFromString.check(Schema.isDateValid()),
    }),
  })
  const jsonSchema = Schema.fromJsonString(event.schema)

  test('roundtrips a valid date through JSON', () => {
    const encoded = Schema.encodeSync(jsonSchema)({ occurredAt })

    expect(encoded).toBe('{"occurredAt":"2026-07-17T10:15:30.000Z"}')
    expect(Schema.decodeSync(jsonSchema)(encoded)).toEqual({ occurredAt })
  })

  test('rejects invalid dates on encode and decode', () => {
    expect(() => Schema.encodeSync(jsonSchema)({ occurredAt: new Date(Number.NaN) })).toThrow()
    expect(() => Schema.decodeSync(jsonSchema)('{"occurredAt":"not-a-date"}')).toThrow()
  })
})
