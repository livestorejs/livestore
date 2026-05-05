import { describe, expect, test } from 'vitest'

import { Option, Schema, SchemaAST } from '@livestore/utils/effect'

import * as F from './field-defs.ts'

describe.concurrent('FieldDefs', () => {
  test('text', () => {
    expectColumn(F.text(), { columnType: 'text', nullable: false, hasDefault: false })
    expectColumn(F.text({}), { columnType: 'text', nullable: false, hasDefault: false })
    expectColumn(F.text({ default: null, nullable: true }), { columnType: 'text', nullable: true, hasDefault: true })

    const literal = F.text({ schema: Schema.Literal('foo'), nullable: true, default: 'foo' })
    expectColumn(literal, { columnType: 'text', nullable: true, hasDefault: true })
    expect(Schema.decodeUnknownSync(literal.schema)('foo')).toBe('foo')

    const literalUnion = F.text({ schema: Schema.Union([Schema.Literal('foo')]), nullable: true, default: 'foo' })
    expectColumn(literalUnion, { columnType: 'text', nullable: true, hasDefault: true })
    expect(Schema.decodeUnknownSync(literalUnion.schema)('foo')).toBe('foo')
  })

  test('json', () => {
    const json = F.json()
    expectColumn(json, { columnType: 'text', nullable: false, hasDefault: false })
    expect(SchemaAST.resolve(Schema.toEncoded(json.schema).ast)?.contentMediaType).toBe('application/json')

    expectColumn(F.json({ default: null, nullable: true }), {
      columnType: 'text',
      nullable: true,
      hasDefault: true,
    })

    const personJson = F.json({ schema: Schema.Struct({ name: Schema.String }), default: { name: 'Bob' }, nullable: true })
    expectColumn(personJson, { columnType: 'text', nullable: true, hasDefault: true })
    expect(Schema.encodeSync(personJson.schema)({ name: 'Bob' })).toBe('{"name":"Bob"}')
  })

  test('datetime', () => {
    expectColumn(F.datetime(), { columnType: 'text', nullable: false, hasDefault: false })
    expectColumn(F.datetime({}), { columnType: 'text', nullable: false, hasDefault: false })
    expectColumn(F.datetime({ default: null, nullable: true }), {
      columnType: 'text',
      nullable: true,
      hasDefault: true,
    })

    const withDefault = F.datetime({ default: new Date('2022-02-02') })
    expectColumn(withDefault, { columnType: 'text', nullable: false, hasDefault: true })
    expect(Schema.encodeSync(withDefault.schema)(new Date('2022-02-02'))).toBe('2022-02-02T00:00:00.000Z')
  })

  test('boolean', () => {
    const boolean = F.boolean()
    expectColumn(boolean, { columnType: 'integer', nullable: false, hasDefault: false })
    expect(Schema.decodeUnknownSync(boolean.schema)(1)).toBe(true)
    expect(Schema.encodeSync(boolean.schema)(false)).toBe(0)

    expectColumn(F.boolean({}), { columnType: 'integer', nullable: false, hasDefault: false })
    expectColumn(F.boolean({ default: false }), { columnType: 'integer', nullable: false, hasDefault: true })
  })
})

const expectColumn = (
  column: F.ColumnDefinition.Any,
  expected: { columnType: F.FieldColumnType; nullable: boolean; hasDefault: boolean },
) => {
  expect(column.columnType).toBe(expected.columnType)
  expect(column.nullable).toBe(expected.nullable)
  expect(Option.isSome(column.default)).toBe(expected.hasDefault)
  expect(column.primaryKey).toBe(false)
  expect(column.autoIncrement).toBe(false)
}
