import { Schema } from '@effect/schema'
import { describe, expect, test } from 'vitest'

import * as F from './field-defs.js'

describe('FieldDefs', () => {
  test('text', () => {
    expect(F.text()).toMatchSnapshot()
    expect(F.text({})).toMatchSnapshot()
    expect(F.text({ default: null, nullable: true })).toMatchSnapshot()
    expect(F.text({ schema: Schema.literal('foo'), nullable: true, default: 'foo' })).toMatchSnapshot()
    expect(F.text({ schema: Schema.union(Schema.literal('foo')), nullable: true, default: 'foo' })).toMatchSnapshot()
  })

  test('json', () => {
    expect(F.json()).toMatchSnapshot()
    expect(F.json({ default: null, nullable: true })).toMatchSnapshot()
    expect(
      F.json({ schema: Schema.struct({ name: Schema.string }), default: { name: 'Bob' }, nullable: true }),
    ).toMatchSnapshot()
  })

  test('datetime', () => {
    expect(F.datetime()).toMatchSnapshot()
    expect(F.datetime({})).toMatchSnapshot()
    expect(F.datetime({ default: null, nullable: true })).toMatchSnapshot()
    expect(F.datetime({ default: new Date('2022-02-02') })).toMatchSnapshot()
  })

  test('boolean', () => {
    expect(F.boolean()).toMatchSnapshot()
    expect(F.boolean({})).toMatchSnapshot()
    expect(F.boolean({ default: false })).toMatchSnapshot()
  })
})
