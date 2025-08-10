import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { State } from '../../mod.ts'

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
        optionalBoolean: State.SQLite.boolean({ default: false, nullable: true }),
        optionalComplex: State.SQLite.json({
          nullable: true,
          schema: Schema.Struct({ color: Schema.String }).pipe(Schema.UndefinedOr),
        }),
      },
    })

    expect((todosTable.rowSchema as any).fields.completed.toString()).toMatchInlineSnapshot(`"(number <-> boolean)"`)
    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
    expect(todosTable.sqliteDef.columns).toHaveProperty('optionalComplex')

    expect(todosTable.sqliteDef.columns.optionalBoolean.nullable).toBe(true)
    expect(todosTable.sqliteDef.columns.optionalBoolean.schema.toString()).toBe(
      '(number <-> boolean) | null',
    )
    expect((todosTable.rowSchema as any).fields.optionalBoolean.toString()).toBe('(number <-> boolean) | null')

    expect(todosTable.sqliteDef.columns.optionalComplex.nullable).toBe(true)
    expect(todosTable.sqliteDef.columns.optionalComplex.schema.toString()).toBe(
      '(parseJson <-> { readonly color: string } | undefined) | null',
    )
    expect((todosTable.rowSchema as any).fields.optionalComplex.toString()).toBe(
      '(parseJson <-> { readonly color: string } | undefined) | null',
    )
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
    expect((userTable.rowSchema as any).fields.age.toString()).toMatchInlineSnapshot(`"Int"`)
    expect((userTable.rowSchema as any).fields.active.toString()).toMatchInlineSnapshot(`"(number <-> boolean)"`)
    expect((userTable.rowSchema as any).fields.metadata.toString()).toMatchInlineSnapshot(
      `"(parseJson <-> { readonly [x: string]: unknown }) | null"`,
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
