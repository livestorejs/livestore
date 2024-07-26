import { Schema } from '@effect/schema'
import { describe, expect, test } from 'vitest'

import type { DiffItem } from './debug-diff.js'
import { debugDiff } from './debug-diff.js'

describe('debug-diff', () => {
  test('simple object', () => {
    const schema = Schema.Struct({
      a: Schema.String,
      b: Schema.Number,
    })

    const a = { a: 'hello', b: 1 }
    const b = { a: 'world', b: 2 }

    const diff = debugDiff(schema)(a, b)
    expect(trimAst(diff)).toMatchInlineSnapshot(`
      [
        {
          "a": "hello",
          "b": "world",
          "path": ".a",
        },
        {
          "a": 1,
          "b": 2,
          "path": ".b",
        },
      ]
    `)
  })

  test('simple object with nested object', () => {
    const schema = Schema.Struct({
      a: Schema.String,
      b: Schema.Struct({
        c: Schema.Number,
      }),
    })
    const a = { a: 'hello', b: { c: 1 } }
    const b = { a: 'world', b: { c: 2 } }
    const diff = debugDiff(schema)(a, b)
    expect(trimAst(diff)).toMatchInlineSnapshot(`
      [
        {
          "a": "hello",
          "b": "world",
          "path": ".a",
        },
        {
          "a": 1,
          "b": 2,
          "path": ".b.c",
        },
      ]
    `)
  })

  test('union', () => {
    const schema = Schema.Union(Schema.String, Schema.Number)
    const a = 'hello'
    const b = 1
    const diff = debugDiff(schema)(a, b)
    expect(trimAst(diff)).toMatchInlineSnapshot(`
      [
        {
          "a": "hello",
          "b": 1,
          "path": "",
        },
      ]
    `)
  })

  test('tagged union', () => {
    const schema = Schema.Union(
      Schema.Struct({ _tag: Schema.Literal('a'), a: Schema.String }),
      Schema.Struct({ _tag: Schema.Literal('b'), b: Schema.Number }),
    )
    const a = { _tag: 'a', a: 'hello' } as const
    const b = { _tag: 'b', b: 1 } as const
    const diff = debugDiff(schema)(a, b)
    expect(trimAst(diff)).toMatchInlineSnapshot(`
      [
        {
          "a": {
            "_tag": "a",
            "a": "hello",
          },
          "b": {
            "_tag": "b",
            "b": 1,
          },
          "path": "",
        },
      ]
    `)
  })
})

const trimAst = (diffItems: DiffItem[]) => diffItems.map(({ ast: _ast, ...rest }) => rest)
