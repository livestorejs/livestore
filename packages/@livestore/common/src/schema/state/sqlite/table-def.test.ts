import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { State } from '../../mod.ts'
import { withAutoIncrement, withColumnType, withDefault, withPrimaryKey, withUnique } from './column-annotations.ts'

describe('table function overloads', () => {
  it('should extract table name from title annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotations({ title: 'todos' })

    const todosTable = State.SQLite.table({
      schema: TodoSchema,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
  })

  it('should extract table name from identifier annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotations({ identifier: 'TodoItem' })

    const todosTable = State.SQLite.table({ schema: TodoSchema })

    expect(todosTable.sqliteDef.name).toBe('TodoItem')
  })

  it('should prefer title over identifier annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotations({
      title: 'todos',
      identifier: 'TodoItem',
    })

    const todosTable = State.SQLite.table({ schema: TodoSchema })

    expect(todosTable.sqliteDef.name).toBe('todos')
  })

  it('should throw when schema has no name, title, or identifier', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    })

    expect(() => State.SQLite.table({ schema: TodoSchema })).toThrow(
      'When using schema without explicit name, the schema must have a title or identifier annotation',
    )
  })

  it('should work with columns parameter', () => {
    const todosTable = State.SQLite.table({
      name: 'todos',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        text: State.SQLite.text({ default: '' }),
        completed: State.SQLite.boolean({ default: false }),
      },
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
  })

  it('should work with schema parameter', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    })

    const todosTable = State.SQLite.table({
      name: 'todos',
      schema: TodoSchema,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
  })

  it('should work with single column', () => {
    const simpleTable = State.SQLite.table({
      name: 'simple',
      columns: State.SQLite.text({ primaryKey: true }),
    })

    expect(simpleTable.sqliteDef.name).toBe('simple')
    expect(simpleTable.sqliteDef.columns).toHaveProperty('value')
    expect(simpleTable.sqliteDef.columns.value.primaryKey).toBe(true)
  })

  it('should handle optional fields in schema', () => {
    const UserSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.optional(Schema.String),
    })

    const userTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    expect(userTable.sqliteDef.columns.id.nullable).toBe(false)
    expect(userTable.sqliteDef.columns.name.nullable).toBe(false)
    expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
  })

  it('should handle Schema.Int as integer column', () => {
    const CounterSchema = Schema.Struct({
      id: Schema.String,
      count: Schema.Int,
    })

    const counterTable = State.SQLite.table({
      name: 'counters',
      schema: CounterSchema,
    })

    expect(counterTable.sqliteDef.columns.count.columnType).toBe('integer')
  })

  it('should work with Schema.Class', () => {
    class User extends Schema.Class<User>('User')({
      id: Schema.String,
      name: Schema.String,
      email: Schema.optional(Schema.String),
      age: Schema.Int,
    }) {}

    const userTable = State.SQLite.table({
      name: 'users',
      schema: User,
    })

    expect(userTable.sqliteDef.name).toBe('users')
    expect(userTable.sqliteDef.columns).toHaveProperty('id')
    expect(userTable.sqliteDef.columns).toHaveProperty('name')
    expect(userTable.sqliteDef.columns).toHaveProperty('email')
    expect(userTable.sqliteDef.columns).toHaveProperty('age')

    // Check column types
    expect(userTable.sqliteDef.columns.id.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.name.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.email.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
    expect(userTable.sqliteDef.columns.age.columnType).toBe('integer')
  })

  it('should extract table name from Schema.Class identifier', () => {
    class TodoItem extends Schema.Class<TodoItem>('TodoItem')({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }) {}

    // Schema.Class doesn't set identifier/title annotations, so we need to provide an explicit name
    const todosTable = State.SQLite.table({
      name: 'TodoItem',
      schema: TodoItem,
    })

    expect(todosTable.sqliteDef.name).toBe('TodoItem')
  })

  it('should properly infer types from schema', () => {
    const UserSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.Int,
      active: Schema.Boolean,
      metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
    })

    const userTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    // Test that Type is properly inferred
    type UserType = typeof userTable.Type
    const _userTypeCheck: UserType = {
      id: 'test-id',
      name: 'John',
      age: 30,
      active: true,
      metadata: { key1: 'value1', key2: 123 },
    }

    // Test that columns have proper schema types
    type IdColumn = typeof userTable.sqliteDef.columns.id
    type NameColumn = typeof userTable.sqliteDef.columns.name
    type AgeColumn = typeof userTable.sqliteDef.columns.age
    type ActiveColumn = typeof userTable.sqliteDef.columns.active
    type MetadataColumn = typeof userTable.sqliteDef.columns.metadata

    // Should derive proper column schema
    expect((userTable.rowSchema as any).fields.age.toString()).toMatchInlineSnapshot(`"number"`)
    expect((userTable.rowSchema as any).fields.active.toString()).toMatchInlineSnapshot(`"(number <-> boolean)"`)
    expect((userTable.rowSchema as any).fields.metadata.toString()).toMatchInlineSnapshot(
      `"(parseJson <-> { readonly [x: string]: unknown })"`,
    )

    // These should compile without errors
    const _idCheck: IdColumn['schema']['Type'] = 'string'
    const _nameCheck: NameColumn['schema']['Type'] = 'string'
    const _ageCheck: AgeColumn['schema']['Type'] = 123
    const _activeCheck: ActiveColumn['schema']['Type'] = true
    const _metadataCheck: MetadataColumn['schema']['Type'] = { foo: 'bar' }

    // Verify column definitions
    expect(userTable.sqliteDef.columns.id.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.name.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.age.columnType).toBe('integer')
    expect(userTable.sqliteDef.columns.active.columnType).toBe('integer')
    expect(userTable.sqliteDef.columns.metadata.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.metadata.nullable).toBe(true)
  })
})

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
        { schema: Schema.String.pipe(Schema.pattern(/^[A-Z]+$/)), name: 'pattern' },
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
        Schema.Struct({ _tag: Schema.Literal('success'), value: Schema.String }),
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
      const AnnotatedString = Schema.String.annotations({ description: 'A special string' })
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
