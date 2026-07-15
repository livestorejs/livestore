import { assert, describe, expect, it } from 'vitest'

import { Schema, SchemaAST, Struct, TestSchema } from '@livestore/utils/effect'

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
      expect(Schema.toEncoded(columnDef.schema).ast._tag).toBe('String')
      expect(
        SchemaAST.resolveAt<{ readonly _tag: string }>('typeConstructor')(Schema.toType(columnDef.schema).ast),
      ).toEqual({ _tag: 'Date' })
    })

    it('should map Schema.DateFromMillis to integer column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.DateFromMillis)
      expect(columnDef.columnType).toBe('integer')
      expect(Schema.toEncoded(columnDef.schema).ast._tag).toBe('Number')
      expect(
        SchemaAST.resolveAt<{ readonly _tag: string }>('typeConstructor')(Schema.toType(columnDef.schema).ast),
      ).toEqual({ _tag: 'Date' })
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

      const positiveInt = State.SQLite.getColumnDefForSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
      expect(positiveInt.columnType).toBe('integer')
    })

    it('should map string refinements to text column', () => {
      const refinements = [
        { schema: Schema.NonEmptyString, name: 'NonEmptyString' },
        { schema: Schema.Trim, name: 'Trim' },
        { schema: Schema.String.check(Schema.isUUID()), name: 'UUID' },
        { schema: Schema.String.check(Schema.isULID()), name: 'ULID' },
        { schema: Schema.String.check(Schema.isMinLength(5)), name: 'minLength' },
        {
          schema: Schema.String.check(Schema.isPattern(/^[A-Z]+$/)),
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
        { schema: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })), name: 'between' },
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
      const StringToNumber = Schema.NumberFromString

      const columnDef = State.SQLite.getColumnDefForSchema(StringToNumber)
      expect(columnDef.columnType).toBe('text') // Based on the encoded type (String)
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
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Record(Schema.String, Schema.Number))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map tuples to json column', () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Tuple([Schema.String, Schema.Number]))
      expect(columnDef.columnType).toBe('text')
    })

    it('should map tagged unions to json column', () => {
      const ResultSchema = Schema.Union([
        Schema.TaggedStruct('success', {
          value: Schema.String,
        }),
        Schema.TaggedStruct('error', { error: Schema.String }),
      ])

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
        Schema.Union([Schema.Struct({ name: Schema.String }), Schema.Undefined]),
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
      const neverSchema = Schema.String.check(Schema.makeFilter(() => false, { message: 'Always fails' }))

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

      const PickedSchema = UserSchema.mapFields(Struct.pick(['id', 'name']))

      const columnDef = State.SQLite.getColumnDefForSchema(PickedSchema)
      expect(columnDef.columnType).toBe('text')
    })

    it('should handle Schema.omit', () => {
      const UserSchema = Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        password: Schema.String,
      })

      const PublicUserSchema = UserSchema.mapFields(Struct.omit(['password']))

      const columnDef = State.SQLite.getColumnDefForSchema(PublicUserSchema)
      expect(columnDef.columnType).toBe('text')
    })
  })

  describe('annotations', () => {
    it('should handle schemas with custom annotations', () => {
      const AnnotatedString = Schema.String.annotate({
        description: 'A special string',
      })
      const AnnotatedNumber = Schema.Number.annotate({ min: 0, max: 100 })

      expect(State.SQLite.getColumnDefForSchema(AnnotatedString).columnType).toBe('text')
      expect(State.SQLite.getColumnDefForSchema(AnnotatedNumber).columnType).toBe('real')
    })
  })

  describe('enums and literal unions', () => {
    it('should handle enums and literal unions as text', () => {
      const StatusEnum = Schema.Enum({
        PENDING: 'pending',
        ACTIVE: 'active',
        INACTIVE: 'inactive',
      })

      const StatusUnion = Schema.Literals(['pending', 'active', 'inactive'])

      expect(State.SQLite.getColumnDefForSchema(StatusEnum).columnType).toBe('text')
      expect(State.SQLite.getColumnDefForSchema(StatusUnion).columnType).toBe('text')
    })

    it('should handle unions of numeric literals as integer column', () => {
      const IntervalSchema = Schema.Literals([1, 5, 15, 30])

      const columnDef = State.SQLite.getColumnDefForSchema(IntervalSchema)

      expect(columnDef.columnType).toBe('integer')
    })

    it('should handle unions of non-integer numeric literals as real column', () => {
      const PercentSchema = Schema.Literals([0.1, 0.2, 0.25])

      const columnDef = State.SQLite.getColumnDefForSchema(PercentSchema)

      expect(columnDef.columnType).toBe('real')
    })
  })

  describe('binary data', () => {
    it('should handle Uint8Array as blob column', async () => {
      const columnDef = State.SQLite.getColumnDefForSchema(Schema.Uint8Array)
      expect(columnDef.columnType).toBe('blob')
      expect(
        SchemaAST.resolveAt<{ readonly _tag: string }>('typeConstructor')(Schema.toType(columnDef.schema).ast),
      ).toEqual({ _tag: 'Uint8Array' })

      const asserts = new TestSchema.Asserts(columnDef.schema)
      await asserts.decoding().succeed(new Uint8Array([1, 2, 3]))
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

  describe('schema-based table definitions', () => {
    it('should handle optional fields in schema', async () => {
      const UserSchema = Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        email: Schema.optional(Schema.String),
        age: Schema.optional(Schema.Number),
      })

      const userTable = State.SQLite.table({
        name: 'users',
        schema: UserSchema,
      })

      // Optional fields should be nullable
      expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
      expect(userTable.sqliteDef.columns.age.nullable).toBe(true)

      // Non-optional fields should not be nullable
      expect(userTable.sqliteDef.columns.id.nullable).toBe(false)
      expect(userTable.sqliteDef.columns.name.nullable).toBe(false)

      const asserts = new TestSchema.Asserts(userTable.rowSchema)
      await asserts.decoding().succeed({
        id: 'user-1',
        name: 'Ada',
        email: null,
        age: null,
      })
    })

    it('should handle optional boolean with proper transformation', async () => {
      const schema = Schema.Struct({
        id: Schema.String,
        active: Schema.optional(Schema.Boolean),
      })

      const table = State.SQLite.table({ name: 'test', schema })

      expect(table.sqliteDef.columns.active.nullable).toBe(true)
      expect(table.sqliteDef.columns.active.columnType).toBe('integer')
      const asserts = new TestSchema.Asserts(table.rowSchema)
      await asserts.decoding().succeed({ id: 'row-1', active: 1 }, { id: 'row-1', active: true })
      expect(Schema.encodeSync(table.sqliteDef.columns.active.schema)(false)).toBe(0)
      await asserts.decoding().succeed({ id: 'row-1', active: null })
    })

    it('should handle optional complex types with JSON encoding', async () => {
      const schema = Schema.Struct({
        id: Schema.String,
        metadata: Schema.optional(Schema.Struct({ color: Schema.String })),
        tags: Schema.optional(Schema.Array(Schema.String)),
      })

      const table = State.SQLite.table({ name: 'test', schema })

      expect(table.sqliteDef.columns.metadata.nullable).toBe(true)
      expect(table.sqliteDef.columns.metadata.columnType).toBe('text')

      expect(table.sqliteDef.columns.tags.nullable).toBe(true)
      expect(table.sqliteDef.columns.tags.columnType).toBe('text')

      const asserts = new TestSchema.Asserts(table.rowSchema)
      await asserts.decoding().succeed(
        {
          id: 'row-1',
          metadata: JSON.stringify({ color: 'red' }),
          tags: JSON.stringify(['urgent', 'local']),
        },
        {
          id: 'row-1',
          metadata: { color: 'red' },
          tags: ['urgent', 'local'],
        },
      )
      await asserts.decoding().succeed({ id: 'row-1', metadata: null, tags: null })
    })

    it('should handle Schema.NullOr', async () => {
      const schema = Schema.Struct({
        id: Schema.String,
        description: Schema.NullOr(Schema.String),
        count: Schema.NullOr(Schema.Int),
      })

      const table = State.SQLite.table({ name: 'test', schema })

      expect(table.sqliteDef.columns.description.nullable).toBe(true)
      expect(table.sqliteDef.columns.count.nullable).toBe(true)

      const asserts = new TestSchema.Asserts(table.rowSchema)
      await asserts.decoding().succeed({
        id: 'row-1',
        description: 'ready',
        count: 1,
      })
      await asserts.decoding().succeed({
        id: 'row-1',
        description: null,
        count: null,
      })
    })

    it('should treat unions of string literals as text columns without JSON parsing', async () => {
      const schema = Schema.Struct({
        id: Schema.String,
        status: Schema.Literals(['idle', 'running', 'stopped']),
      })

      const table = State.SQLite.table({ name: 'timers', schema })

      expect(table.sqliteDef.columns.status.columnType).toBe('text')
      expect(Schema.toEncoded(table.sqliteDef.columns.status.schema).ast._tag).toBe('Union')

      const asserts = new TestSchema.Asserts(table.rowSchema)
      await asserts.decoding().succeed({ id: 'timer-1', status: 'idle' })
    })

    it('should handle Schema.NullOr with complex types', async () => {
      const schema = Schema.Struct({
        data: Schema.NullOr(Schema.Struct({ value: Schema.Number })),
      }).annotate({ title: 'test' })

      const table = State.SQLite.table({ schema })

      expect(table.sqliteDef.columns.data.nullable).toBe(true)
      expect(table.sqliteDef.columns.data.columnType).toBe('text')

      const asserts = new TestSchema.Asserts(table.rowSchema)
      await asserts.decoding().succeed({ data: JSON.stringify({ value: 42 }) }, { data: { value: 42 } })
      await asserts.decoding().succeed({ data: null })
    })

    it('should handle mixed nullable and optional fields', async () => {
      const schema = Schema.Struct({
        nullableText: Schema.NullOr(Schema.String),
        optionalText: Schema.optional(Schema.String),
        optionalJson: Schema.optional(Schema.Struct({ x: Schema.Number })),
      }).annotate({ title: 'test' })

      const table = State.SQLite.table({ schema })

      // Both should be nullable at column level
      expect(table.sqliteDef.columns.nullableText.nullable).toBe(true)
      expect(table.sqliteDef.columns.optionalText.nullable).toBe(true)
      expect(table.sqliteDef.columns.optionalJson.nullable).toBe(true)

      const nullableTextAsserts = new TestSchema.Asserts(table.sqliteDef.columns.nullableText.schema)
      const optionalTextAsserts = new TestSchema.Asserts(table.sqliteDef.columns.optionalText.schema)
      const optionalJsonAsserts = new TestSchema.Asserts(table.sqliteDef.columns.optionalJson.schema)

      await nullableTextAsserts.decoding().succeed('hello')
      await nullableTextAsserts.decoding().succeed(null)
      await optionalTextAsserts.decoding().succeed(null)
      await optionalJsonAsserts.decoding().succeed(JSON.stringify({ x: 1 }), { x: 1 })
      await optionalJsonAsserts.decoding().succeed(null)
    })

    // TODO bring back some time later
    // it('should handle lossy Schema.optional(Schema.NullOr(...)) with JSON encoding', () => {
    //   const schema = Schema.Struct({
    //     id: Schema.String,
    //     lossyText: Schema.optional(Schema.NullOr(Schema.String)),
    //     lossyComplex: Schema.optional(Schema.NullOr(Schema.Struct({ value: Schema.Number }))),
    //   }).annotate({ title: 'lossy_test' })

    //   const table = State.SQLite.table({ schema })

    //   // Check column definitions for lossy fields
    //   expect(table.sqliteDef.columns.lossyText.nullable).toBe(true)
    //   expect(table.sqliteDef.columns.lossyText.columnType).toBe('text')
    //   expect(table.sqliteDef.columns.lossyComplex.nullable).toBe(true)
    //   expect(table.sqliteDef.columns.lossyComplex.columnType).toBe('text')

    //   // Check schema representations - should use parseJson for lossy encoding
    //   expect((table.rowSchema as any).fields.lossyText.toString()).toBe('(parseJson <-> string | null)')
    //   expect((table.rowSchema as any).fields.lossyComplex.toString()).toBe(
    //     '(parseJson <-> { readonly value: number } | null)',
    //   )

    //   // Note: Since we're converting undefined to null, this is a lossy transformation.
    //   // The test now just verifies that the schemas are set up correctly for JSON encoding.
    // })
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
        })

        const userTable = State.SQLite.table({
          name: 'users',
          schema: UserSchema,
        })

        expect(userTable.sqliteDef.columns.id.primaryKey).toBe(true)
        expect(userTable.sqliteDef.columns.id.nullable).toBe(false)
        expect(userTable.sqliteDef.columns.name.primaryKey).toBe(false)
        expect(userTable.sqliteDef.columns.name.nullable).toBe(false)
      })

      it('should throw when primary key is used with optional schema', () => {
        // Note: Schema.optional returns a property signature, not a schema, so we can't pipe it
        // Instead, we use Schema.Union to create an optional schema that can be piped
        const optionalString = Schema.Union([Schema.String, Schema.Undefined])
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
          id: Schema.Number.pipe(withColumnType('integer'), withPrimaryKey),
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
          id: Schema.Int.pipe(withPrimaryKey, withAutoIncrement),
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

      it('should support thunk defaults without eager evaluation', () => {
        let counter = 0
        const UserSchema = Schema.Struct({
          id: Schema.String.pipe(
            withDefault(() => {
              counter += 1
              return `user-${counter}`
            }),
          ),
        })

        const table = State.SQLite.table({ name: 'users_with_thunk', schema: UserSchema })

        expect(counter).toBe(0)
        expect(table.sqliteDef.columns.id.default._tag).toBe('Some')
        if (table.sqliteDef.columns.id.default._tag === 'Some') {
          const defaultThunk = table.sqliteDef.columns.id.default.value
          assert(typeof defaultThunk === 'function')
          expect(defaultThunk()).toBe('user-1')
          expect(defaultThunk()).toBe('user-2')
        }
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
        const schema = Schema.Uint8ArrayFromBase64.pipe(withColumnType('blob'), withPrimaryKey)

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
          id: Schema.Int.pipe(withPrimaryKey, withAutoIncrement),
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
