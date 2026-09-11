import { describe, expect, test } from 'vitest'

import { Schema } from '@livestore/utils/effect'

import { liveStoreStorageFormatVersion } from '../../../../../version.ts'
import {
  blob,
  boolean,
  datetime,
  integer,
  json,
  makeState,
  real,
  text,
  withDefault,
  withPrimaryKey,
} from '../../mod.ts'
import { table } from '../../table-def.ts'
import { SqliteDsl } from '../mod.ts'
import { digestToFingerprint } from './fingerprint-digest.ts'
import { fingerprint } from './fingerprint.ts'

/** the DSL AST is derived from a table's field schemas, so build it through `table()` */
const makeTable = (name: string, columns: Schema.Struct.Fields, indexes?: SqliteDsl.Index[]) =>
  table({ name, columns, ...(indexes === undefined ? {} : { indexes }) }).sqliteDef

describe('SQLite storage fingerprints', () => {
  test('pins the final fingerprint output', () => {
    expect(fingerprint(makePhysicalTable().ast)).toBe('UnLwYzVBhwzPCK5q7TrPU3q2N0dTe8m_98bud8HsAs8')
    expect(fingerprint(makeJsonTable('documents', representativeJsonSchema).ast)).toBe(
      'kUzaurzV2rcXYLljHOZ64TDR9c_RebqD7y5ZUM_nPBE',
    )
    expect(makeState({ tables: [], materializers: {} }).sqlite.hash).toBe('H5Uktp6Ffp84WDj_RWPnfDnaQEu_E61AMl7ieZ9Zn8k')
  })

  test('matches the standard SHA-256 vector', () => {
    expect(digestToFingerprint(new TextEncoder().encode('abc'))).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  })

  test('keeps the full digest inside the Cloudflare VFS filename limit', () => {
    const value = fingerprint(makePhysicalTable().ast)

    expect(value).toHaveLength(43)
    expect(`state${value}@${liveStoreStorageFormatVersion}.db`.length).toBeLessThanOrEqual(56)
  })

  test('keeps the fingerprint of every table definition shape stable', () => {
    // Storage identity must survive changes to how table definitions are built. Each pair is a table
    // shape and the fingerprint it had before column helpers returned field schemas; a changed value
    // here means every database defining that shape rematerializes on upgrade. The date-codec row
    // is pinned to its post-#1597 value: before, such a column was JSON text that could not be read.
    const Point = Schema.Struct({ x: Schema.Finite, tags: Schema.Array(Schema.String) })
    const shapes: ReadonlyArray<readonly [{ sqliteDef: { ast: Parameters<typeof fingerprint>[0] } }, string]> = [
      [
        table({
          name: 't',
          columns: {
            id: text({ primaryKey: true }),
            n: integer({ default: 1 }),
            b: boolean({ default: true }),
            d: datetime({ nullable: true }),
            r: real(),
            bl: blob({ nullable: true }),
          },
        }),
        'AEL44RzxvJn373Br0g4hPvVHgv_viSsW2EnoBjpXbq0',
      ],
      [
        table({ name: 't', columns: { id: text({ primaryKey: true }), v: json() } }),
        'CVeE9zGdjEbAxgGQhJ-P5R5W7zcaY9g8qOcyLv8G64o',
      ],
      [
        table({ name: 't', columns: { id: text({ primaryKey: true }), v: json({ nullable: true }) } }),
        '5544IFy-wMvx9r0RXaoYYcFeONX6ix2yW1hECWxp1Nc',
      ],
      [
        table({ name: 't', columns: { id: text({ primaryKey: true }), v: json({ schema: Point }) } }),
        'fB5QLwHe4I-sI1JG5lMhYo48HQA8aXoQDSGUW3W4Y2E',
      ],
      [
        table({ name: 't', columns: { id: text({ primaryKey: true }), v: json({ schema: Point, nullable: true }) } }),
        'QbM-mmQ0RyNRbjWm1suiG7TgMLm11yVOI1Y91Nfybko',
      ],
      [
        table({
          name: 't',
          columns: { id: text({ primaryKey: true }), v: json({ schema: Point, default: { x: 1, tags: [] } }) },
        }),
        'VZKGurvAE8YF1m7oCbTCPZhHWtLmA8JouRcvNG_l0VU',
      ],
      [
        table({
          name: 't',
          columns: { id: text({ primaryKey: true }), v: json({ schema: Point, nullable: true, default: null }) },
        }),
        '1RYAccWxhEGNDjc9VHw-3L36vq8HYabzdrywZZc08qo',
      ],
      [
        table({
          name: 't',
          columns: { id: text({ primaryKey: true }), v: json({ schema: Point, default: () => ({ x: 1, tags: [] }) }) },
        }),
        '_vzWalqhAfvsPySbAlCwGrJ2kmmqY3O8Kc1CnuYAJjw',
      ],
      [
        table({
          name: 't',
          columns: { id: text({ primaryKey: true }), v: text({ schema: Schema.fromJsonString(Point) }) },
        }),
        'fB5QLwHe4I-sI1JG5lMhYo48HQA8aXoQDSGUW3W4Y2E',
      ],
      [
        table({ name: 't', schema: Schema.Struct({ id: Schema.String.pipe(withPrimaryKey), v: Point }) }),
        'fB5QLwHe4I-sI1JG5lMhYo48HQA8aXoQDSGUW3W4Y2E',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({ id: Schema.String.pipe(withPrimaryKey), v: Schema.NullOr(Point) }),
        }),
        'QbM-mmQ0RyNRbjWm1suiG7TgMLm11yVOI1Y91Nfybko',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({ id: Schema.String.pipe(withPrimaryKey), v: Schema.optional(Point) }),
        }),
        'QbM-mmQ0RyNRbjWm1suiG7TgMLm11yVOI1Y91Nfybko',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({
            id: Schema.String.pipe(withPrimaryKey),
            v: Point.pipe(withDefault({ x: 1, tags: [] })),
          }),
        }),
        'VZKGurvAE8YF1m7oCbTCPZhHWtLmA8JouRcvNG_l0VU',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({ id: Schema.String.pipe(withPrimaryKey), v: Schema.Array(Schema.String) }),
        }),
        'Oq6RY68071fpjiYuI-fHfEU87UZAB_AZ7prbzVpMcXI',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({
            id: Schema.String.pipe(withPrimaryKey),
            v: Schema.Literals(['a', 'b']),
            w: Schema.optional(Schema.Boolean),
          }),
        }),
        'C8kBw5B-VjQaj_57Bh1aF6QVkofjxf79K9ZRAiGz9Sg',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({
            id: Schema.String.pipe(withPrimaryKey),
            v: Schema.String.pipe(withDefault('x')),
            w: Schema.Int.pipe(withDefault(0)),
          }),
        }),
        'vn6JLhkCU_1_np3ap5wy-QlNNaX4nDjbbM-o2d9vwYM',
      ],
      [
        table({
          name: 't',
          schema: Schema.Struct({
            id: Schema.String.pipe(withPrimaryKey),
            v: Schema.DateFromString,
            w: Schema.NullOr(Schema.DateFromMillis),
          }),
        }),
        'C8kBw5B-VjQaj_57Bh1aF6QVkofjxf79K9ZRAiGz9Sg',
      ],
    ]
    for (const [tableDef, expected] of shapes) expect(fingerprint(tableDef.sqliteDef.ast)).toBe(expected)
  })

  test('is independent of table and index declaration order', () => {
    const first = makeJsonTable('first', Schema.Struct({ value: Schema.String }))
    const second = makeJsonTable('second', Schema.Struct({ value: Schema.Finite }))

    expect(fingerprint({ _tag: 'dbSchema', tables: [first.ast, second.ast] })).toBe(
      fingerprint({ _tag: 'dbSchema', tables: [second.ast, first.ast] }),
    )

    const table = makeTable(
      'indexed',
      {
        id: SqliteDsl.text({ primaryKey: true }),
        age: SqliteDsl.integer(),
      },
      [
        { name: 'indexed_by_age', columns: ['age'], isUnique: false },
        { name: 'indexed_by_id', columns: ['id'], isUnique: true },
      ],
    ).ast
    expect(fingerprint({ ...table, indexes: table.indexes.toReversed() })).toBe(fingerprint(table))
  })

  test('ignores Effect metadata that does not affect accepted encoded JSON', () => {
    const plain = makeJsonTable('documents', Schema.Struct({ value: Schema.String }))
    const annotated = makeJsonTable(
      'documents',
      Schema.Struct({ value: Schema.String }).annotate({ description: 'documentation only', title: 'Document' }),
    )
    const readonlyArray = makeJsonTable('documents', Schema.Array(Schema.String))
    const mutableArray = makeJsonTable('documents', Schema.mutable(Schema.Array(Schema.String)))

    expect(fingerprint(plain.ast)).toBe(fingerprint(annotated.ast))
    expect(fingerprint(readonlyArray.ast)).toBe(fingerprint(mutableArray.ast))
  })

  test('changes when represented JSON checks change', () => {
    const minimumTwo = makeJsonTable('documents', Schema.Struct({ value: Schema.String.check(Schema.isMinLength(2)) }))
    const minimumThree = makeJsonTable(
      'documents',
      Schema.Struct({ value: Schema.String.check(Schema.isMinLength(3)) }),
    )

    expect(fingerprint(minimumTwo.ast)).not.toBe(fingerprint(minimumThree.ast))
  })

  test('distinguishes codecs with the same encoded primitive', () => {
    const date = makeJsonTable('documents', Schema.Struct({ value: Schema.DateFromString }))
    const string = makeJsonTable('documents', Schema.Struct({ value: Schema.String }))

    expect(fingerprint(date.ast)).not.toBe(fingerprint(string.ast))
  })

  test('handles recursive JSON schemas deterministically', () => {
    const first = makeJsonTable('trees', makeTreeSchema())
    const second = makeJsonTable('trees', makeTreeSchema())

    expect(fingerprint(first.ast)).toBe(fingerprint(second.ast))
  })

  test('supports opaque Effect schemas without persistence annotations', () => {
    const OpaqueString = Schema.declare<string>((value): value is string => typeof value === 'string')
    const table = makeJsonTable('opaque_documents', Schema.Struct({ value: OpaqueString }))

    expect(() => fingerprint(table.ast)).not.toThrow()
  })

  test('keeps application-owned representation payload fields', () => {
    const first = Schema.declare<string>((value): value is string => typeof value === 'string', {
      representation: { id: 'example/opaque', payload: { annotations: 'first', isMutable: true } },
    })
    const second = Schema.declare<string>((value): value is string => typeof value === 'string', {
      representation: { id: 'example/opaque', payload: { annotations: 'second', isMutable: true } },
    })

    expect(fingerprint(makeJsonTable('documents', first).ast)).not.toBe(
      fingerprint(makeJsonTable('documents', second).ast),
    )
  })

  test('tracks JSON codecs passed through the generic text column API', () => {
    const first = makeTable('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(Schema.Struct({ value: Schema.String })) }),
    })
    const second = makeTable('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(Schema.Struct({ value: Schema.Finite })) }),
    })

    expect(fingerprint(first.ast)).not.toBe(fingerprint(second.ast))
  })

  test('gives equivalent JSON DSL forms the same fingerprint', () => {
    const valueSchema = Schema.Struct({ value: Schema.String })
    const specialized = makeTable('documents', {
      value: SqliteDsl.json({ schema: valueSchema }),
    })
    const generic = makeTable('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(valueSchema) }),
    })

    expect(fingerprint(specialized.ast)).toBe(fingerprint(generic.ast))
  })

  test('classifies physical defaults without hashing function source text', () => {
    const none = SqliteDsl.text()
    const firstThunk = SqliteDsl.text({ default: () => 'first' })
    const secondThunk = SqliteDsl.text({ default: () => 'second' })
    const literal = SqliteDsl.text({ default: 'first' })
    const fingerprintOf = (definition: Schema.Top) => fingerprint(makeTable('defaults', { value: definition }).ast)

    expect(fingerprintOf(firstThunk)).toBe(fingerprintOf(secondThunk))
    expect(fingerprintOf(firstThunk)).not.toBe(fingerprintOf(none))
    expect(fingerprintOf(literal)).not.toBe(fingerprintOf(firstThunk))
  })
})

const makePhysicalTable = () =>
  makeTable(
    'users',
    {
      id: SqliteDsl.text({ primaryKey: true }),
      age: SqliteDsl.integer({ nullable: true }),
    },
    [{ name: 'users_by_age', columns: ['age'], isUnique: false }],
  )

const makeJsonTable = (name: string, schema: Schema.Codec<unknown, unknown>) =>
  makeTable(name, {
    id: SqliteDsl.text({ primaryKey: true }),
    value: SqliteDsl.json({ schema }),
  })

const representativeJsonSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)),
  tags: Schema.Array(Schema.String),
  status: Schema.Union([Schema.Literal('draft'), Schema.Literal('published')]),
  publishedAt: Schema.NullOr(Schema.DateFromString),
  metadata: Schema.Record(Schema.String, Schema.Json),
})

interface TreeNode {
  readonly value: string
  readonly children: ReadonlyArray<TreeNode>
}

const makeTreeSchema = (): Schema.Codec<TreeNode> => {
  const TreeNode: Schema.Codec<TreeNode> = Schema.Struct({
    value: Schema.String,
    children: Schema.Array(Schema.suspend(() => TreeNode)),
  })
  return TreeNode
}
