import { Schema } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { tables } from '../../../__tests__/fixture.ts'
import type * as LiveStoreEvent from '../../LiveStoreEvent.ts'
import { ClientDocumentTableDefSymbol, clientDocument, mergeDefaultValues } from './client-document-def.ts'

describe('client document table', () => {
  test('set event', () => {
    expect(patchId(tables.UiState.set({ showSidebar: false }, 'session-1'))).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "session-1",
          "value": {
            "showSidebar": false,
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "UiStateSet",
      }
    `)

    expect(patchId(tables.appConfig.set({ fontSize: 12, theme: 'dark' }))).toMatchInlineSnapshot(`
      {
        "args": {
          "id": "static",
          "value": {
            "fontSize": 12,
            "theme": "dark",
          },
        },
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "AppConfigSet",
      }
    `)
  })

  describe('materializer', () => {
    const forSchema = <T>(schema: Schema.Schema<T, any>, value: T, id?: string, options?: { partialSet?: boolean }) => {
      const Doc = clientDocument({
        name: 'test',
        schema,
        default: { value },
        ...options,
      })

      const materializer = Doc[ClientDocumentTableDefSymbol].derived.setMaterializer

      return materializer(Doc.set(value, id as any).args, {
        currentFacts: new Map(),
        query: {} as any, // unused
        eventDef: Doc[ClientDocumentTableDefSymbol].derived.setEventDef,
      })
    }

    test('string value', () => {
      expect(forSchema(Schema.String, 'hello', 'id1')).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            ""hello"",
            ""hello"",
          ],
          "sql": "INSERT INTO 'test' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('struct value (partial set=true)', () => {
      expect(
        forSchema(Schema.Struct({ a: Schema.String }), { a: 'hello' }, 'id1', { partialSet: true }),
      ).toMatchInlineSnapshot(`
          {
            "bindValues": [
              "id1",
              "{"a":"hello"}",
              "$.a",
              ""hello"",
            ],
            "sql": "
                INSERT INTO 'test' (id, value)
                VALUES (?, ?)
                ON CONFLICT (id) DO UPDATE SET value = json_set(value, ?, json(?))
              ",
            "writeTables": Set {
              "test",
            },
          }
        `)
    })

    test('struct value (partial set=false)', () => {
      expect(
        forSchema(Schema.Struct({ a: Schema.String }), { a: 'hello' }, 'id1', { partialSet: false }),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{"a":"hello"}",
            "{"a":"hello"}",
          ],
          "sql": "INSERT INTO 'test' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('struct value (partial set=true) advanced', () => {
      expect(
        forSchema(
          Schema.Struct({ a: Schema.String, b: Schema.String, c: Schema.Number }),
          { a: 'hello', c: 123 } as any,
          'id1',
          { partialSet: true },
        ),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{"a":"hello","c":123}",
            "$.a",
            ""hello"",
            "$.c",
            "123",
          ],
          "sql": "
              INSERT INTO 'test' (id, value)
              VALUES (?, ?)
              ON CONFLICT (id) DO UPDATE SET value = json_set(json_set(value, ?, json(?)), ?, json(?))
            ",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('struct value (partial set=true), explicit undefined, filter out undefined values', () => {
      expect(
        forSchema(
          Schema.Struct({ a: Schema.String.pipe(Schema.optional), b: Schema.String }),
          { a: undefined, b: 'hello' },
          'id1',
          {
            partialSet: true,
          },
        ),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{"b":"hello"}",
            "$.b",
            ""hello"",
          ],
          "sql": "
              INSERT INTO 'test' (id, value)
              VALUES (?, ?)
              ON CONFLICT (id) DO UPDATE SET value = json_set(value, ?, json(?))
            ",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('struct value (partial set=true), explicit undefined, nothing to update', () => {
      expect(
        forSchema(Schema.Struct({ a: Schema.String.pipe(Schema.optional) }), { a: undefined }, 'id1', {
          partialSet: true,
        }),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{}",
          ],
          "sql": "
              INSERT INTO 'test' (id, value)
              VALUES (?, ?)
              ON CONFLICT (id) DO NOTHING
            ",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('struct union value', () => {
      expect(
        forSchema(
          Schema.Union(Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.String })),
          { a: 'hello' },
          'id1',
        ),
      ).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{"a":"hello"}",
            "{"a":"hello"}",
          ],
          "sql": "INSERT INTO 'test' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('array value', () => {
      expect(forSchema(Schema.Array(Schema.String), ['hello', 'world'], 'id1')).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "["hello","world"]",
            "["hello","world"]",
          ],
          "sql": "INSERT INTO 'test' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })

    test('any value (Schema.Any) should fully replace', () => {
      expect(forSchema(Schema.Any, { a: 1 }, 'id1')).toMatchInlineSnapshot(`
        {
          "bindValues": [
            "id1",
            "{\"a\":1}",
            "{\"a\":1}",
          ],
          "sql": "INSERT INTO 'test' (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = ?",
          "writeTables": Set {
            "test",
          },
        }
      `)
    })
  })
})

const patchId = (muationEvent: LiveStoreEvent.PartialAnyDecoded) => {
  // TODO use new id paradigm
  const id = `00000000-0000-0000-0000-000000000000`
  return { ...muationEvent, id }
}

describe('mergeDefaultValues', () => {
  test('merges values from both objects', () => {
    const defaults = { a: 1, b: 2 }
    const explicit = { a: 10, b: 20 }
    const result = mergeDefaultValues(defaults, explicit)

    expect(result).toEqual({ a: 10, b: 20 })
  })

  test('uses default values when explicit values are undefined', () => {
    const defaults = { a: 1, b: 2 }
    const explicit = { a: undefined, b: 20 } as any
    const result = mergeDefaultValues(defaults, explicit)

    expect(result).toEqual({ a: 1, b: 20 })
  })

  test('should preserve properties that are not in default values', () => {
    const defaults = { a: 1, b: 2 }
    const explicit = { a: 10, b: 20, c: 30 }
    const result = mergeDefaultValues(defaults, explicit)

    // Should include ALL properties from explicit, not just those in defaults
    expect(result).toEqual({ a: 10, b: 20, c: 30 })
    expect('c' in result).toBe(true)
  })

  test('issue #487 - should preserve optional fields not in defaults', () => {
    const defaults = {
      newTodoText: '',
      filter: 'all' as const,
    }
    const userSet = {
      newTodoText: '',
      description: 'First attempt', // Optional field not in defaults
      filter: 'all' as const,
    }
    const result = mergeDefaultValues(defaults, userSet)

    // Should include the description field even though it's not in defaults
    expect(result).toEqual({
      newTodoText: '',
      description: 'First attempt',
      filter: 'all',
    })
    expect('description' in result).toBe(true)
  })

  test('handles non-object values', () => {
    expect(mergeDefaultValues('default', 'explicit')).toBe('explicit')
    expect(mergeDefaultValues(42, 100)).toBe(100)
    expect(mergeDefaultValues(null, { a: 1 })).toEqual({ a: 1 })
    expect(mergeDefaultValues({ a: 1 }, null)).toBe(null)
  })

  test('handles nested objects (current implementation does not deep merge)', () => {
    const defaults = { a: { x: 1, y: 2 }, b: 3 }
    const explicit = { a: { x: 10 }, b: 30 } as any
    const result = mergeDefaultValues(defaults, explicit)

    // Current implementation replaces entire nested object
    expect(result).toEqual({ a: { x: 10 }, b: 30 })
    // Note: 'y' is lost because the entire 'a' object is replaced
  })

  test('should handle mix of default and new properties', () => {
    const defaults = {
      required1: 'default1',
      required2: 'default2',
    }
    const userSet = {
      required1: 'user1', // Override default
      required2: 'default2', // Keep default
      optional1: 'new1', // New field
      optional2: 'new2', // New field
    }
    const result = mergeDefaultValues(defaults, userSet)

    expect(result).toEqual({
      required1: 'user1',
      required2: 'default2',
      optional1: 'new1',
      optional2: 'new2',
    })
    expect(Object.keys(result).sort()).toEqual(['optional1', 'optional2', 'required1', 'required2'])
  })
})
