import { Schema, SchemaAST } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { withColumnType, withPrimaryKey } from './column-annotations.ts'

describe.concurrent('annotations', () => {
  describe('withPrimaryKey', () => {
    test('should add primary key annotation', () => {
      const schema = Schema.String
      const result = withPrimaryKey(schema)

      expect(SchemaAST.annotations(result.ast, {})).toMatchInlineSnapshot(`
        {
          "_tag": "StringKeyword",
          "annotations": {
            "Symbol(effect/annotation/Description)": "a string",
            "Symbol(effect/annotation/Title)": "string",
            "Symbol(livestore/state/sqlite/annotations/primary-key)": true,
          },
        }
      `)
    })
  })

  describe('withColumnType', () => {
    describe('compatible schema-column type combinations', () => {
      test('Schema.String with text column type', () => {
        expect(() => withColumnType(Schema.String, 'text')).not.toThrow()
      })

      test('Schema.Number with integer column type', () => {
        expect(() => withColumnType(Schema.Number, 'integer')).not.toThrow()
      })

      test('Schema.Number with real column type', () => {
        expect(() => withColumnType(Schema.Number, 'real')).not.toThrow()
      })

      test('Schema.Boolean with integer column type', () => {
        expect(() => withColumnType(Schema.Boolean, 'integer')).not.toThrow()
      })

      test('Schema.Uint8ArrayFromSelf with blob column type', () => {
        expect(() => withColumnType(Schema.Uint8ArrayFromSelf, 'blob')).not.toThrow()
      })

      test('Schema.Date with text column type', () => {
        expect(() => withColumnType(Schema.Date, 'text')).not.toThrow()
      })

      test('String literal with text column type', () => {
        expect(() => withColumnType(Schema.Literal('hello'), 'text')).not.toThrow()
      })

      test('Number literal with integer column type', () => {
        expect(() => withColumnType(Schema.Literal(42), 'integer')).not.toThrow()
      })

      test('Number literal with real column type', () => {
        expect(() => withColumnType(Schema.Literal(3.14), 'real')).not.toThrow()
      })

      test('Boolean literal with integer column type', () => {
        expect(() => withColumnType(Schema.Literal(true), 'integer')).not.toThrow()
      })

      test('Union of same type with compatible column type', () => {
        const unionSchema = Schema.Union(Schema.Literal('a'), Schema.Literal('b'))
        expect(() => withColumnType(unionSchema, 'text')).not.toThrow()
      })

      test('Transformation schema with compatible base type', () => {
        const transformSchema = Schema.transform(Schema.String, Schema.String, {
          decode: (s) => s.toUpperCase(),
          encode: (s) => s.toLowerCase(),
        })
        expect(() => withColumnType(transformSchema, 'text')).not.toThrow()
      })
    })

    // TODO bring those tests back as we've implemented the column type validation
    // describe('incompatible schema-column type combinations', () => {
    //   test('Schema.String with integer column type should throw', () => {
    //     expect(() => withColumnType(Schema.String, 'integer')).toThrow(
    //       "Schema type 'string' is incompatible with column type 'integer'",
    //     )
    //   })

    //   test('Schema.String with real column type should throw', () => {
    //     expect(() => withColumnType(Schema.String, 'real')).toThrow(
    //       "Schema type 'string' is incompatible with column type 'real'",
    //     )
    //   })

    //   test('Schema.String with blob column type should throw', () => {
    //     expect(() => withColumnType(Schema.String, 'blob')).toThrow(
    //       "Schema type 'string' is incompatible with column type 'blob'",
    //     )
    //   })

    //   test('Schema.Number with text column type should throw', () => {
    //     expect(() => withColumnType(Schema.Number, 'text')).toThrow(
    //       "Schema type 'number' is incompatible with column type 'text'",
    //     )
    //   })

    //   test('Schema.Number with blob column type should throw', () => {
    //     expect(() => withColumnType(Schema.Number, 'blob')).toThrow(
    //       "Schema type 'number' is incompatible with column type 'blob'",
    //     )
    //   })

    //   test('Schema.Boolean with text column type should throw', () => {
    //     expect(() => withColumnType(Schema.Boolean, 'text')).toThrow(
    //       "Schema type 'boolean' is incompatible with column type 'text'",
    //     )
    //   })

    //   test('Schema.Boolean with real column type should throw', () => {
    //     expect(() => withColumnType(Schema.Boolean, 'real')).toThrow(
    //       "Schema type 'boolean' is incompatible with column type 'real'",
    //     )
    //   })

    //   test('Schema.Boolean with blob column type should throw', () => {
    //     expect(() => withColumnType(Schema.Boolean, 'blob')).toThrow(
    //       "Schema type 'boolean' is incompatible with column type 'blob'",
    //     )
    //   })

    //   test('Schema.Uint8ArrayFromSelf with text column type should throw', () => {
    //     expect(() => withColumnType(Schema.Uint8ArrayFromSelf, 'text')).toThrow(
    //       "Schema type 'uint8array' is incompatible with column type 'text'",
    //     )
    //   })

    //   test('String literal with integer column type should throw', () => {
    //     expect(() => withColumnType(Schema.Literal('hello'), 'integer')).toThrow(
    //       "Schema type 'string' is incompatible with column type 'integer'",
    //     )
    //   })

    //   test('Number literal with text column type should throw', () => {
    //     expect(() => withColumnType(Schema.Literal(42), 'text')).toThrow(
    //       "Schema type 'number' is incompatible with column type 'text'",
    //     )
    //   })

    //   test('Schema.Date with integer column type should throw', () => {
    //     expect(() => withColumnType(Schema.Date, 'integer')).toThrow(
    //       "Schema type 'string' is incompatible with column type 'integer'",
    //     )
    //   })
    // })

    describe('complex schemas', () => {
      test('should allow complex schemas that cannot be determined', () => {
        const complexSchema = Schema.Struct({ name: Schema.String, age: Schema.Number })
        expect(() => withColumnType(complexSchema, 'text')).not.toThrow()
      })

      test('should allow Schema.Any with any column type', () => {
        expect(() => withColumnType(Schema.Any, 'text')).not.toThrow()
        expect(() => withColumnType(Schema.Any, 'integer')).not.toThrow()
        expect(() => withColumnType(Schema.Any, 'real')).not.toThrow()
        expect(() => withColumnType(Schema.Any, 'blob')).not.toThrow()
      })

      test('should allow Schema.Unknown with any column type', () => {
        expect(() => withColumnType(Schema.Unknown, 'text')).not.toThrow()
        expect(() => withColumnType(Schema.Unknown, 'integer')).not.toThrow()
        expect(() => withColumnType(Schema.Unknown, 'real')).not.toThrow()
        expect(() => withColumnType(Schema.Unknown, 'blob')).not.toThrow()
      })
    })

    describe('annotation behavior', () => {
      test('should add column type annotation to schema', () => {
        const schema = Schema.String
        const result = withColumnType(schema, 'text')

        expect(SchemaAST.annotations(result.ast, {})).toMatchInlineSnapshot(`
          {
            "_tag": "StringKeyword",
            "annotations": {
              "Symbol(effect/annotation/Description)": "a string",
              "Symbol(effect/annotation/Title)": "string",
              "Symbol(livestore/state/sqlite/annotations/column-type)": "text",
            },
          }
        `)
      })

      test('should preserve existing annotations', () => {
        const schema = withPrimaryKey(Schema.String)
        const result = withColumnType(schema, 'text')

        expect(SchemaAST.annotations(result.ast, {})).toMatchInlineSnapshot(`
          {
            "_tag": "StringKeyword",
            "annotations": {
              "Symbol(effect/annotation/Description)": "a string",
              "Symbol(effect/annotation/Title)": "string",
              "Symbol(livestore/state/sqlite/annotations/column-type)": "text",
              "Symbol(livestore/state/sqlite/annotations/primary-key)": true,
            },
          }
        `)
      })
    })
  })
})
