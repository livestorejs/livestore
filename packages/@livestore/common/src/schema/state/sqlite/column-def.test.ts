import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

import * as State from '../mod.ts'
import { withAutoIncrement, withColumnType, withDefault, withPrimaryKey, withUnique } from './column-annotations.ts'

describe('getColumnDefForSchema', () => {
  describe('basic types', () => {
    it('should map Schema.String to text column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.String)
      expect(columnDef.columnType).toBe('text')
    })

    it('should map Schema.Number to real column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Number)
      expect(columnDef.columnType).toBe('real')
    })

    it('should map Schema.Boolean to integer column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Boolean)
      expect(columnDef.columnType).toBe('integer')
    })

    it('should map Schema.Date to text column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Date)
      expect(columnDef.columnType).toBe('text')
    })

    it('should map Schema.BigInt to text column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.BigInt)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('refinements', () => {
    it('should map Schema.Int to integer column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Int)
      expect(columnDef.columnType).toBe('integer')
    })

    it('should map string refinements to text column', () => {
      const refinements = [
        { schema: Schema.NonEmptyString, name: 'NonEmptyString' },
        { schema: Schema.Trim, name: 'Trim' },
        { schema: Schema.UUID, name: 'UUID' },
        { schema: Schema.ULID, name: 'ULID' },
        { schema: Schema.String.pipe(Schema.minLength(5)), name: 'minLength' },
        {
          schema: Schema.String.pipe(Schema.pattern(/^[A-Z]+$/)),
          name: 'pattern',
        },
      ]

      for (const { schema, name } of refinements) {
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType, `${name} should map to text`).toBe('text')
      }
    })

    it('should map number refinements to real column', () => {
      const refinements = [
        { schema: Schema.Finite, name: 'Finite' },
        { schema: Schema.Number.pipe(Schema.positive()), name: 'positive' },
        { schema: Schema.Number.pipe(Schema.between(0, 100)), name: 'between' },
      ]

      for (const { schema, name } of refinements) {
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType, `${name} should map to real`).toBe('real')
      }
    })
  })

  describe('literal types', () => {
    it('should map string literals to text column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Literal('active'))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map number literals to real column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Literal(42))
      expect(columnDef.columnType).toBe('real')
    })

    it('should map boolean literals to integer column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Literal(true))
      expect(columnDef.columnType).toBe('integer')
    })
  })

  describe('transformations', () => {
    it('should map transformations based on target type', () => {
      const StringToNumber = Schema.String.pipe(
        Schema.transform(Schema.Number, {
          decode: Number.parseFloat,
          encode: String,
        }),
      )

      const columnDef = State.SQLite.getColumnDefForSchema(StringToNumber)
      expect(columnDef.columnType).toBe('real') // Based on the target type (Number)
    })

    it('should handle Date transformations', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Date)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('complex types', () => {
    it('should map structs to json column', () => {
      const UserSchema = Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
      })

      const columnDef = State.SQLite.getColumnDefForSchema(UserSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should map arrays to json column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Array(Schema.String))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map records to json column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Record({ key: Schema.String, value: Schema.Number }))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map tuples to json column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Tuple(Schema.String, Schema.Number))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map tagged unions to json column', () => {
      const ResultSchema = Schema.Union(
        Schema.Struct({
          _tag: Schema.Literal('success'),
          value: Schema.String,
        }),
        Schema.Struct({ _tag: Schema.Literal('error'), error: Schema.String }),
      )

      const columnDef = State.SQLite.getColumnDefForSchema(ResultSchema)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('nested schemas', () => {
    it('should handle deeply nested schemas', () => {
      const NestedSchema = Schema.Struct({
        level1: Schema.Struct({
          level2: Schema.Struct({
            value: Schema.String,
          }),
        }),
      })

      const columnDef = State.SQLite.getColumnDefForSchema(NestedSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should handle optional nested schemas', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(
        Schema.Union(Schema.Struct({ name: Schema.String }), Schema.Undefined),
      )
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('edge cases', () => {
    it('should default to json column for unhandled types', () => {
      // Test various edge cases that all result in JSON columns
      const edgeCases = [
        { schema: Schema.Unknown, name: 'Unknown' },
        { schema: Schema.Any, name: 'Any' },
        { schema: Schema.Null, name: 'Null' },
        { schema: Schema.Undefined, name: 'Undefined' },
        { schema: Schema.Void, name: 'Void' },
      ]

      for (const { schema, name } of edgeCases) {
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType, `${name} should map to text (JSON storage)`).toBe('text')
      }
    })

    it('should handle never schema', () => {
      // Create a schema that should never validate
      const neverSchema = Schema.String.pipe(Schema.filter(() => false, { message: () => 'Always fails' }))

      const columnDef = State.SQLite.getColumnDefForSchema(neverSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should handle symbol schema', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Symbol)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('custom schemas', () => {
    it('should handle Schema.extend', () => {
      const BaseSchema = Schema.Struct({
        id: Schema.String,
        createdAt: Schema.Date,
      })

      const ExtendedSchema = Schema.Struct({
        ...BaseSchema.fields,
        name: Schema.String,
        updatedAt: Schema.Date,
      })

      const columnDef = State.SQLite.getColumnDefForSchema(ExtendedSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should handle Schema.pick', () => {
      const UserSchema = Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        email: Schema.String,
      })

      const PickedSchema = UserSchema.pipe(Schema.pick('id', 'name'))

      const columnDef = State.SQLite.getColumnDefForSchema(PickedSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should handle Schema.omit', () => {
      const UserSchema = Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        password: Schema.String,
      })

      const PublicUserSchema = UserSchema.pipe(Schema.omit('password'))

      const columnDef = State.SQLite.getColumnDefForSchema(PublicUserSchema)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('annotations', () => {
    it('should handle schemas with custom annotations', () => {
      const AnnotatedString = Schema.String.annotations({
        description: 'A special string',
      })
      const AnnotatedNumber = Schema.Number.annotations({ min: 0, max: 100 })

      expect(State.SQLite.getColumnDefForSchema(AnnotatedString).columnType).toBe('text')
      expect(State.SQLite.getColumnDefForSchema(AnnotatedNumber).columnType).toBe('real')
    })
  })

  describe('enums and literal unions', () => {
    it('should handle enums and literal unions as text', () => {
      const StatusEnum = Schema.Enums({
        PENDING: 'pending',
        ACTIVE: 'active',
        INACTIVE: 'inactive',
      })

      const StatusUnion = Schema.Union(Schema.Literal('pending'), Schema.Literal('active'), Schema.Literal('inactive'))

      expect(State.SQLite.getColumnDefForSchema(StatusEnum).columnType).toBe('text')
      expect(State.SQLite.getColumnDefForSchema(StatusUnion).columnType).toBe('text')
    })
  })

  describe('binary data', () => {
    it('should handle Uint8Array as blob column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Uint8Array)
      expect(columnDef.columnType).toBe('text') // Stored as JSON
    })
  })

  describe('recursive schemas', () => {
    it('should handle recursive schemas as json', () => {
      interface TreeNode {
        readonly value: string
        readonly children: ReadonlyArray<TreeNode>
      }
      const TreeNode: Schema.Schema<TreeNode> = Schema.Struct({
        value: Schema.String,
        children: Schema.Array(Schema.suspend(() => TreeNode)),
      })

      const columnDef = State.SQLite.getColumnDefForSchema(TreeNode)
      expect(columnDef.columnType).toBe('text') // Complex type stored as JSON
    })
  })

  describe('annotations', () => {
    describe('withColumnType', () => {
      it('should respect column type annotation for text', () => {
        const schema = Schema.Number.pipe(withColumnType('text'))
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType).toBe('text')
      })

      it('should respect column type annotation for integer', () => {
        const schema = Schema.String.pipe(withColumnType('integer'))
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType).toBe('integer')
      })

      it('should respect column type annotation for real', () => {
        const schema = Schema.Boolean.pipe(withColumnType('real'))
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType).toBe('real')
      })

      it('should respect column type annotation for blob', () => {
        const schema = Schema.String.pipe(withColumnType('blob'))
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType).toBe('blob')
      })

      it('should override default type mapping', () => {
        // Number normally maps to real, but we override to text
        const schema = Schema.Number.pipe(withColumnType('text'))
        const columnDef = State.SQLite.getColumnDefForSchema(schema)
        expect(columnDef.columnType).toBe('text')
      })

      it('should work with dual API', () => {
        // Test both forms of the dual API
        const schema1 = withColumnType(Schema.String, 'integer')
        const schema2 = Schema.String.pipe(withColumnType('integer'))

        const columnDef1 = State.SQLite.getColumnDefForSchema(schema1)
        const columnDef2 = State.SQLite.getColumnDefForSchema(schema2)

        expect(columnDef1.columnType).toBe('integer')
        expect(columnDef2.columnType).toBe('integer')
      })
    })

    describe('withPrimaryKey', () => {
      it('should add primary key annotation to schema', () => {
        const UserSchema = Schema.Struct({
          id: Schema.String.pipe(withPrimaryKey),
          name: Schema.String,
          email: Schema.optional(Schema.String),
          nullable: Schema.NullOr(Schema.Int),
          optionalComplex: Schema.optional(Schema.Struct({ color: Schema.String })),
          optionalNullableText: Schema.optional(Schema.NullOr(Schema.String)),
          optionalNullableComplex: Schema.optional(Schema.NullOr(Schema.Struct({ color: Schema.String }))),
        })

        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
        expect(userTable.sqliteDef.columns.id.nullable).toBe(false)
        expect(userTable.sqliteDef.columns.name.primaryKey).toBe(false)
        expect(userTable.sqliteDef.columns.email.primaryKey).toBe(false)
        expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
        expect(userTable.sqliteDef.columns.nullable.primaryKey).toBe(false)
        expect(userTable.sqliteDef.columns.nullable.nullable).toBe(true)
        expect(userTable.sqliteDef.columns.optionalComplex.nullable).toBe(true)
        expect((userTable.rowSchema as any).fields.email.toString()).toBe('string | undefined')
        expect((userTable.rowSchema as any).fields.nullable.toString()).toBe('Int | null')
        expect((userTable.rowSchema as any).fields.optionalComplex.toString()).toBe(
          '(parseJson <-> { readonly color: string } | undefined)',
        )
      })

      it('should handle Schema.NullOr with complex types', () => {
        const schema = Schema.Struct({
          data: Schema.NullOr(Schema.Struct({ value: Schema.Number })),
        }).annotations({ title: 'test' })

        const table = State.SQLite.table({ schema })

        expect(table.sqliteDef.columns.data.nullable).toBe(true)
        expect(table.sqliteDef.columns.data.columnType).toBe('text')
        expect((table.rowSchema as any).fields.data.toString()).toBe('{ readonly value: number } | null')
      })

      it('should handle mixed nullable and optional fields', () => {
        const schema = Schema.Struct({
          nullableText: Schema.NullOr(Schema.String),
          optionalText: Schema.optional(Schema.String),
          optionalJson: Schema.optional(Schema.Struct({ x: Schema.Number })),
        }).annotations({ title: 'test' })

        const table = State.SQLite.table({ schema })

        // Both should be nullable at column level
        expect(table.sqliteDef.columns.nullableText.nullable).toBe(true)
        expect(table.sqliteDef.columns.optionalText.nullable).toBe(true)
        expect(table.sqliteDef.columns.optionalJson.nullable).toBe(true)

        // But different schema representations
        expect((table.rowSchema as any).fields.nullableText.toString()).toBe('string | null')
        expect((table.rowSchema as any).fields.optionalText.toString()).toBe('string | undefined')
        expect((table.rowSchema as any).fields.optionalJson.toString()).toBe(
          '(parseJson <-> { readonly x: number } | undefined)',
        )
      })

      it('should handle lossy Schema.optional(Schema.NullOr(...)) with JSON encoding', () => {
        const schema = Schema.Struct({
          id: Schema.String,
          lossyText: Schema.optional(Schema.NullOr(Schema.String)),
          lossyComplex: Schema.optional(Schema.NullOr(Schema.Struct({ value: Schema.Number }))),
        }).annotations({ title: 'lossy_test' })

        const table = State.SQLite.table({ schema })

        // Check column definitions for lossy fields
        expect(table.sqliteDef.columns.lossyText.nullable).toBe(true)
        expect(table.sqliteDef.columns.lossyText.columnType).toBe('text')
        expect(table.sqliteDef.columns.lossyComplex.nullable).toBe(true)
        expect(table.sqliteDef.columns.lossyComplex.columnType).toBe('text')

        // Check schema representations - should use parseJson for lossless encoding
        expect((table.rowSchema as any).fields.lossyText.toString()).toBe('(parseJson <-> string | null | undefined)')
        expect((table.rowSchema as any).fields.lossyComplex.toString()).toBe(
          '(parseJson <-> { readonly value: number } | null | undefined)',
        )

        // Test actual data round-tripping to ensure losslessness
        // Note: Missing field case is challenging with current Effect Schema design
        // as optional fields are handled at struct level, not field level
        const testCases = [
          // For now, test only cases where both lossy fields are present
          { name: 'both explicit null', data: { id: '2', lossyText: null, lossyComplex: null } },
          { name: 'text value, complex null', data: { id: '3', lossyText: 'hello', lossyComplex: null } },
          { name: 'text null, complex value', data: { id: '4', lossyText: null, lossyComplex: { value: 42 } } },
          { name: 'both values', data: { id: '5', lossyText: 'world', lossyComplex: { value: 42 } } },
        ]

        testCases.forEach((testCase) => {
          // Encode through insert schema
          const encoded = Schema.encodeSync(table.insertSchema)(testCase.data)
          // Decode through row schema
          const decoded = Schema.decodeSync(table.rowSchema)(encoded)

          // Check for losslessness
          expect(decoded).toEqual(testCase.data)
        })
      })

      it('should throw when primary key is used with optional schema', () => {
        // Note: Schema.optional returns a property signature, not a schema, so we can't pipe it
        // Instead, we use Schema.Union to create an optional schema that can be piped
        const optionalString = Schema.Union(Schema.String, Schema.Undefined)
        const UserSchema = Schema.Struct({
          id: optionalString.pipe(withPrimaryKey),
          name: Schema.String,
        })

        expect(() =>
          State.SQLite.table({
            name: 'users',
            schema: UserSchema,
          }),
        ).toThrow('Primary key columns cannot be nullable')
      })

      it('should throw when primary key is used with NullOr schema', () => {
        const UserSchema = Schema.Struct({
          id: Schema.NullOr(Schema.String).pipe(withPrimaryKey),
          name: Schema.String,
        })

        expect(() =>
          State.SQLite.table({
            name: 'users',
            schema: UserSchema,
          }),
        ).toThrow('Primary key columns cannot be nullable')
      })

      it('should work with column type annotation', () => {
        const UserSchema = Schema.Struct({
          id: Schema.Number.pipe(withColumnType('integer')).pipe(withPrimaryKey),
          name: Schema.String,
        })

        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        expect(userTable.sqliteDef.columns.id.columnType).toBe('integer')
        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
      })

      it('should work with Schema.Int and primary key', () => {
        const UserSchema = Schema.Struct({
          id: Schema.Int.pipe(withPrimaryKey),
          name: Schema.String,
        })

        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        expect(userTable.sqliteDef.columns.id.columnType).toBe('integer')
        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
      })
    })

    describe('withAutoIncrement', () => {
      it('should add autoIncrement annotation to schema', () => {
        const UserSchema = Schema.Struct({
          id: Schema.Int.pipe(withPrimaryKey).pipe(withAutoIncrement),
          name: Schema.String,
        })
        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })
        expect(userTable.sqliteDef.columns.id.autoIncrement).toBe(true)
        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
        expect(userTable.sqliteDef.columns.id.columnType).toBe('integer')
      })
    })

    describe('withDefault', () => {
      it('should add default value annotation to schema', () => {
        const UserSchema = Schema.Struct({
          id: Schema.String,
          active: Schema.Boolean.pipe(withDefault(true)),
          createdAt: Schema.String.pipe(withDefault('CURRENT_TIMESTAMP')),
        })
        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })
        expect(userTable.sqliteDef.columns.active.default._tag).toBe('Some')
        expect(
          userTable.sqliteDef.columns.active.default._tag === 'Some' &&
            userTable.sqliteDef.columns.active.default.value,
        ).toBe(true)
        expect(userTable.sqliteDef.columns.createdAt.default._tag).toBe('Some')
        expect(
          userTable.sqliteDef.columns.createdAt.default._tag === 'Some' &&
            userTable.sqliteDef.columns.createdAt.default.value,
        ).toBe('CURRENT_TIMESTAMP')
      })

      it('should work with dual API', () => {
        const schema1 = withDefault(Schema.Int, 0)
        const schema2 = Schema.Int.pipe(withDefault(0))
        const UserSchema1 = Schema.Struct({ count: schema1 })
        const UserSchema2 = Schema.Struct({ count: schema2 })
        const table1 = State.SQLite.table({ name: 't1', schema: UserSchema1 })
        const table2 = State.SQLite.table({ name: 't2', schema: UserSchema2 })
        expect(table1.sqliteDef.columns.count.default._tag).toBe('Some')
        expect(
          table1.sqliteDef.columns.count.default._tag === 'Some' && table1.sqliteDef.columns.count.default.value,
        ).toBe(0)
        expect(table2.sqliteDef.columns.count.default._tag).toBe('Some')
        expect(
          table2.sqliteDef.columns.count.default._tag === 'Some' && table2.sqliteDef.columns.count.default.value,
        ).toBe(0)
      })
    })

    describe('withUnique', () => {
      it('should create unique index for column with unique annotation', () => {
        const UserSchema = Schema.Struct({
          id: Schema.String,
          email: Schema.String.pipe(withUnique),
          username: Schema.String.pipe(withUnique),
        })
        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        // Check that unique indexes were created
        const uniqueIndexes = userTable.sqliteDef.indexes?.filter((idx) => idx.isUnique) || []
        expect(uniqueIndexes).toHaveLength(2)
        expect(
          uniqueIndexes.some((idx) => idx.name === 'idx_users_email_unique' && idx.columns.includes('email')),
        ).toBe(true)
        expect(
          uniqueIndexes.some((idx) => idx.name === 'idx_users_username_unique' && idx.columns.includes('username')),
        ).toBe(true)
      })

      it('should combine unique indexes with user-provided indexes', () => {
        const UserSchema = Schema.Struct({
          id: Schema.String,
          email: Schema.String.pipe(withUnique),
        })
        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
          indexes: [{ name: 'idx_custom', columns: ['id', 'email'] }],
        })

        // Should have both custom index and unique index
        expect(userTable.sqliteDef.indexes).toHaveLength(2)
        expect(userTable.sqliteDef.indexes?.some((idx) => idx.name === 'idx_custom')).toBe(true)
        expect(userTable.sqliteDef.indexes?.some((idx) => idx.name === 'idx_users_email_unique')).toBe(true)
      })
    })

    describe('combined annotations', () => {
      it('should work with multiple annotations', () => {
        const schema = Schema.Uint8ArrayFromBase64.pipe(withColumnType('blob')).pipe(withPrimaryKey)

        const UserSchema = Schema.Struct({
          id: schema,
          name: Schema.String,
        })

        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        expect(userTable.sqliteDef.columns.id.columnType).toBe('blob')
        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
      })

      it('should combine all annotations', () => {
        const UserSchema = Schema.Struct({
          id: Schema.Int.pipe(withPrimaryKey).pipe(withAutoIncrement),
          email: Schema.String.pipe(withUnique),
          status: Schema.String.pipe(withDefault('active')),
          metadata: Schema.Unknown.pipe(withColumnType('text')),
        })
        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        // Check id column
        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
        expect(userTable.sqliteDef.columns.id.autoIncrement).toBe(true)
        expect(userTable.sqliteDef.columns.id.columnType).toBe('integer')

        // Check email column and unique index
        expect(userTable.sqliteDef.columns.email.columnType).toBe('text')
        expect(userTable.sqliteDef.indexes?.some((idx) => idx.name === 'idx_users_email_unique' && idx.isUnique)).toBe(
          true,
        )

        // Check status column
        expect(userTable.sqliteDef.columns.status.default._tag).toBe('Some')
        expect(
          userTable.sqliteDef.columns.status.default._tag === 'Some' &&
            userTable.sqliteDef.columns.status.default.value,
        ).toBe('active')

        // Check metadata column
        expect(userTable.sqliteDef.columns.metadata.columnType).toBe('text')
      })
    })
  })
})
