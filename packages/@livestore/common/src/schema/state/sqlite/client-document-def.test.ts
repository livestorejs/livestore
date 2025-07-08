import { Schema } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { tables } from '../../../__tests__/fixture.js'
import type * as LiveStoreEvent from '../../LiveStoreEvent.js'
import { ClientDocumentTableDefSymbol, clientDocument } from './client-document-def.js'

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
  })
})

const patchId = (muationEvent: LiveStoreEvent.PartialAnyDecoded) => {
  // TODO use new id paradigm
  const id = `00000000-0000-0000-0000-000000000000`
  return { ...muationEvent, id }
}
