import { TestSchema } from 'effect/testing'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { Schema, SchemaAST, SchemaTransformation } from '@livestore/utils/effect'

import { State } from '../../mod.ts'

describe('table function overloads', () => {
  it('should extract table name from title annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotate({ title: 'todos' })

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
    }).annotate({ identifier: 'TodoItem' })

    const todosTable = State.SQLite.table({ schema: TodoSchema })

    expect(todosTable.sqliteDef.name).toBe('TodoItem')
  })

  it('should prefer title over identifier annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotate({
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

  it('should work with columns parameter', async () => {
    const todosTable = State.SQLite.table({
      name: 'todos',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        text: State.SQLite.text({ default: '' }),
        completed: State.SQLite.boolean({ default: false }),
        optionalBoolean: State.SQLite.boolean({ default: false, nullable: true }),
        optionalComplex: State.SQLite.json({
          nullable: true,
          schema: Schema.Struct({ color: Schema.String }).pipe(Schema.UndefinedOr),
        }),
      },
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
    expect(todosTable.sqliteDef.columns).toHaveProperty('optionalComplex')

    expect(todosTable.sqliteDef.columns.optionalBoolean.nullable).toBe(true)
    expect(Schema.encodeSync(todosTable.sqliteDef.columns.optionalBoolean.schema)(false)).toBe(0)

    expect(todosTable.sqliteDef.columns.optionalComplex.nullable).toBe(true)

    const asserts = new TestSchema.Asserts(todosTable.rowSchema)
    await asserts.decoding().succeed(
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: 1,
        optionalBoolean: null,
        optionalComplex: JSON.stringify({ color: 'red' }),
      },
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: true,
        optionalBoolean: null,
        optionalComplex: { color: 'red' },
      },
    )
    await asserts.decoding().succeed(
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: 0,
        optionalBoolean: null,
        optionalComplex: null,
      },
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: false,
        optionalBoolean: null,
        optionalComplex: null,
      },
    )
  })

  it('should allow explicit first two generic arguments without options generic', () => {
    const columns = {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
    }

    const todosTable = State.SQLite.table<'todos', typeof columns>({
      name: 'todos',
      columns,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
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

  it('should support schemas that transform flat columns into nested types', () => {
    const Flat = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      contactFirstName: Schema.String,
      contactLastName: Schema.String,
      contactEmail: Schema.String.pipe(State.SQLite.withUnique),
    })

    const Nested = Flat.pipe(
      Schema.decodeTo(
        Schema.Struct({
          id: Schema.String,
          contact: Schema.Struct({
            firstName: Schema.String,
            lastName: Schema.String,
            email: Schema.String,
          }),
        }),
        SchemaTransformation.transform({
          decode: ({ id, contactFirstName, contactLastName, contactEmail }) => ({
            id,
            contact: {
              firstName: contactFirstName,
              lastName: contactLastName,
              email: contactEmail,
            },
          }),
          encode: ({ id, contact }) => ({
            id,
            contactFirstName: contact.firstName,
            contactLastName: contact.lastName,
            contactEmail: contact.email,
          }),
        }),
      ),
    )

    const contactsTable = State.SQLite.table({
      name: 'contacts',
      schema: Nested,
    })

    const columns = contactsTable.sqliteDef.columns

    expect(Object.keys(columns)).toEqual(['id', 'contactFirstName', 'contactLastName', 'contactEmail'])
    expect(columns.id.primaryKey).toBe(true)
    expect(columns.contactEmail.columnType).toBe('text')
    expect(contactsTable.sqliteDef.indexes).toContainEqual({
      name: 'idx_contacts_contactEmail_unique',
      columns: ['contactEmail'],
      isUnique: true,
    })
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

  it('should properly infer types from schema', async () => {
    const UserSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.Int,
      active: Schema.Boolean,
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
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

    const asserts = new TestSchema.Asserts(userTable.rowSchema)
    await asserts.decoding().succeed(
      {
        id: 'test-id',
        name: 'John',
        age: 30,
        active: 1,
        metadata: JSON.stringify({ key1: 'value1', key2: 123 }),
      },
      {
        id: 'test-id',
        name: 'John',
        age: 30,
        active: true,
        metadata: { key1: 'value1', key2: 123 },
      },
    )
    const activeAsserts = new TestSchema.Asserts(userTable.sqliteDef.columns.active.schema)
    const metadataAsserts = new TestSchema.Asserts(userTable.sqliteDef.columns.metadata.schema)
    await activeAsserts.decoding().succeed(0, false)
    await metadataAsserts.decoding().succeed(null)
  })

  it('should allow omitting nullable fields in insert()', () => {
    const UserSchema = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      undefined: Schema.Undefined,
      null: Schema.Null,
      undefinedOrString: Schema.UndefinedOr(Schema.String),
      nullOrString: Schema.NullOr(Schema.String),
      optionalString: Schema.optional(Schema.String),
      optionalNullOrString: Schema.optional(Schema.NullOr(Schema.String)),
    })

    const usersTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    // Non-nullable fields (id) are required — omitting id should be rejected
    expectTypeOf<{ undefined: undefined }>().not.toExtend<Parameters<typeof usersTable.insert>[0]>()

    // Nullable fields (NullOr, optional+NullOr) are omittable — SQL defaults to NULL
    expectTypeOf(usersTable.insert)
      .toBeCallableWith({ id: '1' })
      .toBeCallableWith({ id: '1', undefined: undefined })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: undefined })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string' })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: null })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
        optionalNullOrString: null,
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
        optionalNullOrString: 'string',
      })

    expect(() => usersTable.insert({ id: '1' }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', undefined: undefined }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', undefined: undefined, null: null }).asSql()).not.toThrow()
    expect(() =>
      usersTable.insert({ id: '1', undefined: undefined, null: null, undefinedOrString: undefined }).asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable.insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string' }).asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: null })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: 'string' })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
        })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
          optionalNullOrString: null,
        })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
          optionalNullOrString: 'string',
        })
        .asSql(),
    ).not.toThrow()
  })

  it('supports discriminated unions with parsed JSON payloads', () => {
    const CircleDataSchema = Schema.Struct({
      radius: Schema.Number,
    })
    const CircleSchema = Schema.Struct({
      kind: Schema.Literal('circle'),
      data: Schema.fromJsonString(CircleDataSchema),
    })

    const SquareDataSchema = Schema.Struct({
      sideLength: Schema.Number,
    })
    const SquareSchema = Schema.Struct({
      kind: Schema.Literal('square'),
      data: Schema.fromJsonString(SquareDataSchema),
    })

    const ShapeSchema = Schema.Union([CircleSchema, SquareSchema])

    const shapes = State.SQLite.table({
      name: 'shapes',
      schema: ShapeSchema,
    })

    expect(shapes.sqliteDef.columns.kind.columnType).toBe('text')
    expect(SchemaAST.isUnion(Schema.toEncoded(shapes.sqliteDef.columns.kind.schema).ast)).toBe(true)

    expect(() =>
      shapes
        .insert({
          kind: 'square',
          data: { sideLength: 10 },
        })
        .asSql(),
    ).not.toThrow()

    expect(() =>
      shapes
        .insert({
          kind: 'circle',
          data: { radius: 5 },
        })
        .asSql(),
    ).not.toThrow()
  })

  it('treats optional common union fields as nullable columns', () => {
    const StateSchema = Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('empty'),
        note: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal('ready'),
        note: Schema.optional(Schema.String),
      }),
    ])

    const states = State.SQLite.table({
      name: 'states',
      schema: StateSchema,
    })

    expect(states.sqliteDef.columns.kind.columnType).toBe('text')
    expect(states.sqliteDef.columns.note.columnType).toBe('text')
    expect(states.sqliteDef.columns.note.nullable).toBe(true)
  })
})
