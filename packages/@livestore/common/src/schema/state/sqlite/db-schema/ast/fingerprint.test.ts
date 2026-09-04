import { describe, expect, test } from 'vitest'

import { Schema } from '@livestore/utils/effect'

import { liveStoreStorageFormatVersion } from '../../../../../version.ts'
import { makeState } from '../../mod.ts'
import { SqliteDsl } from '../mod.ts'
import { digestToFingerprint } from './fingerprint-digest.ts'
import { fingerprint } from './fingerprint.ts'

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

  test('is independent of table and index declaration order', () => {
    const first = makeJsonTable('first', Schema.Struct({ value: Schema.String }))
    const second = makeJsonTable('second', Schema.Struct({ value: Schema.Finite }))

    expect(fingerprint({ _tag: 'dbSchema', tables: [first.ast, second.ast] })).toBe(
      fingerprint({ _tag: 'dbSchema', tables: [second.ast, first.ast] }),
    )

    const table = SqliteDsl.table(
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
    const first = SqliteDsl.table('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(Schema.Struct({ value: Schema.String })) }),
    })
    const second = SqliteDsl.table('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(Schema.Struct({ value: Schema.Finite })) }),
    })

    expect(fingerprint(first.ast)).not.toBe(fingerprint(second.ast))
  })

  test('gives equivalent JSON DSL forms the same fingerprint', () => {
    const valueSchema = Schema.Struct({ value: Schema.String })
    const specialized = SqliteDsl.table('documents', {
      value: SqliteDsl.json({ schema: valueSchema }),
    })
    const generic = SqliteDsl.table('documents', {
      value: SqliteDsl.text({ schema: Schema.fromJsonString(valueSchema) }),
    })

    expect(fingerprint(specialized.ast)).toBe(fingerprint(generic.ast))
  })

  test('classifies physical defaults without hashing function source text', () => {
    const none = SqliteDsl.text()
    const firstThunk = SqliteDsl.text({ default: () => 'first' })
    const secondThunk = SqliteDsl.text({ default: () => 'second' })
    const literal = SqliteDsl.text({ default: 'first' })
    const toTable = (definition: SqliteDsl.ColumnDefinition.Any) =>
      SqliteDsl.table('defaults', { value: definition }).ast

    expect(fingerprint(toTable(firstThunk))).toBe(fingerprint(toTable(secondThunk)))
    expect(fingerprint(toTable(firstThunk))).not.toBe(fingerprint(toTable(none)))
    expect(fingerprint(toTable(literal))).not.toBe(fingerprint(toTable(firstThunk)))
  })
})

const makePhysicalTable = () =>
  SqliteDsl.table(
    'users',
    {
      id: SqliteDsl.text({ primaryKey: true }),
      age: SqliteDsl.integer({ nullable: true }),
    },
    [{ name: 'users_by_age', columns: ['age'], isUnique: false }],
  )

const makeJsonTable = (name: string, schema: Schema.Codec<unknown, unknown>) =>
  SqliteDsl.table(name, {
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
