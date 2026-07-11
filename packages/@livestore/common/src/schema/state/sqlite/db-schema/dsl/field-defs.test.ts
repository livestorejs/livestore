import { describe, expect, test } from 'vite-plus/test'

import { Schema } from '@livestore/utils/effect'

import * as F from './field-defs.ts'

describe('FieldDefs', () => {
  test('text', () => {
    expect(columnDefSnapshot(F.text())).toMatchSnapshot()
    expect(columnDefSnapshot(F.text({}))).toMatchSnapshot()
    expect(columnDefSnapshot(F.text({ default: null, nullable: true }))).toMatchSnapshot()
    expect(
      columnDefSnapshot(F.text({ schema: Schema.Literal('foo'), nullable: true, default: 'foo' })),
    ).toMatchSnapshot()
    expect(
      columnDefSnapshot(F.text({ schema: Schema.Union([Schema.Literal('foo')]), nullable: true, default: 'foo' })),
    ).toMatchSnapshot()
  })

  test('json', () => {
    expect(columnDefSnapshot(F.json())).toMatchSnapshot()
    expect(columnDefSnapshot(F.json({ default: null, nullable: true }))).toMatchSnapshot()
    expect(
      columnDefSnapshot(
        F.json({ schema: Schema.Struct({ name: Schema.String }), default: { name: 'Bob' }, nullable: true }),
      ),
    ).toMatchSnapshot()
  })

  test('datetime', () => {
    expect(columnDefSnapshot(F.datetime())).toMatchSnapshot()
    expect(columnDefSnapshot(F.datetime({}))).toMatchSnapshot()
    expect(columnDefSnapshot(F.datetime({ default: null, nullable: true }))).toMatchSnapshot()
    expect(columnDefSnapshot(F.datetime({ default: new Date('2022-02-02') }))).toMatchSnapshot()
  })

  test('boolean', () => {
    expect(columnDefSnapshot(F.boolean())).toMatchSnapshot()
    expect(columnDefSnapshot(F.boolean({}))).toMatchSnapshot()
    expect(columnDefSnapshot(F.boolean({ default: false }))).toMatchSnapshot()
  })
})

const columnDefSnapshot = (columnDef: F.ColumnDefinition.Any) => ({
  ...columnDef,
  schema: schemaSnapshot(columnDef.schema),
})

// Effect schemas expose a large inspectable object graph. Snapshot only the
// schema shape this DSL cares about.
const schemaSnapshot = (schema: Schema.Codec<unknown, unknown>) => ({
  ast: schema.ast._tag,
  encodedAst: Schema.toEncoded(schema).ast._tag,
  decodedAst: Schema.toType(schema).ast._tag,
})
