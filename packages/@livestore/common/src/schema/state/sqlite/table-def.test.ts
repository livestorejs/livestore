import { describe, expect, expectTypeOf, it } from 'vitest'

import { objectToString } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { State } from '../../mod.ts'

describe('State.SQLite.table', () => {
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
    expect(objectToString(todosTable.sqliteDef.columns.optionalBoolean.schema)).toBe('(number <-> boolean) | null')
    expect((todosTable.rowSchema as any).fields.optionalBoolean.toString()).toBe('(number <-> boolean) | null')

    expect(todosTable.sqliteDef.columns.optionalComplex.nullable).toBe(true)
    expect(objectToString(todosTable.sqliteDef.columns.optionalComplex.schema)).toBe(
      '(parseJson <-> { readonly color: string } | undefined) | null',
    )
    expect((todosTable.rowSchema as any).fields.optionalComplex.toString()).toBe(
      '(parseJson <-> { readonly color: string } | undefined) | null',
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

  it('should work with single column', () => {
    const simpleTable = State.SQLite.table({
      name: 'simple',
      columns: State.SQLite.text({ primaryKey: true }),
    })

    expect(simpleTable.sqliteDef.name).toBe('simple')
    expect(simpleTable.sqliteDef.columns).toHaveProperty('value')
    expect(simpleTable.sqliteDef.columns.value.primaryKey).toBe(true)
  })

  it('treats nullable columns and columns with defaults as omittable in insert()', () => {
    const usersTable = State.SQLite.table({
      name: 'users',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        name: State.SQLite.text({ nullable: false }),
        nickname: State.SQLite.text({ nullable: true }),
        role: State.SQLite.text({ default: 'member' }),
      },
    })

    // Primary key + non-nullable columns without a default are required.
    // Nullable columns and columns with a default are omittable (SQL fills NULL / the default).
    expectTypeOf(usersTable.insert)
      .toBeCallableWith({ id: '1', name: 'Ada' })
      .toBeCallableWith({ id: '1', name: 'Ada', nickname: null })
      .toBeCallableWith({ id: '1', name: 'Ada', nickname: 'ada', role: 'admin' })

    expect(() => usersTable.insert({ id: '1', name: 'Ada' }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', name: 'Ada', nickname: null }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', name: 'Ada', nickname: 'ada', role: 'admin' }).asSql()).not.toThrow()
  })
})
