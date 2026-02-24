import { describe, expect, it } from 'vitest'
import { Schema } from '@livestore/utils/effect'

import { defineCommand } from './command/command-def.ts'
import { synced } from './events.ts'
import { isLiveStoreSchema, makeSchema } from './schema.ts'
import * as SQLite from './state/sqlite/mod.ts'

const todoCreated = synced({
  name: 'todo.created',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
})

const todoCompleted = synced({
  name: 'todo.completed',
  schema: Schema.Struct({ id: Schema.String }),
})

const events = { todoCreated, todoCompleted }

const todos = SQLite.table({
  name: 'todos',
  columns: {
    id: SQLite.text({ primaryKey: true }),
    text: SQLite.text({ default: '' }),
    completed: SQLite.boolean({ default: false }),
  },
})

const materializers = SQLite.materializers(events, {
  'todo.created': ({ id, text }) => todos.insert({ id, text, completed: false }),
  'todo.completed': ({ id }) => todos.update({ completed: true }).where({ id }),
})

const state = SQLite.makeState({ tables: { todos }, materializers })

const createTodo = defineCommand({
  name: 'CreateTodo',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  handler: ({ id, text }) => todoCreated({ id, text }),
})

const completeTodo = defineCommand({
  name: 'CompleteTodo',
  schema: Schema.Struct({ id: Schema.String }),
  handler: ({ id }) => todoCompleted({ id }),
})

describe('makeSchema', () => {
  describe('commands as record', () => {
    const schema = makeSchema({ state, events, commands: { createTodo, completeTodo } })

    it('populates commandDefsMap from record values', () => {
      expect(schema.commandDefsMap).toBeInstanceOf(Map)
      expect(schema.commandDefsMap.size).toBe(2)
      expect(schema.commandDefsMap.has('CreateTodo')).toBe(true)
      expect(schema.commandDefsMap.has('CompleteTodo')).toBe(true)
    })

    it('uses command .name as map key, ignoring record keys', () => {
      const schema = makeSchema({
        state,
        events,
        commands: { arbitraryKey: createTodo },
      })

      expect(schema.commandDefsMap.has('CreateTodo')).toBe(true)
      expect(schema.commandDefsMap.has('arbitraryKey')).toBe(false)
    })

    it('preserves handler and schema on stored definitions', () => {
      const def = schema.commandDefsMap.get('CreateTodo')!
      expect(def.name).toBe('CreateTodo')
      expect(typeof def.handler).toBe('function')
      expect(def.schema).toBe(createTodo.schema)
    })
  })

  describe('commands as array', () => {
    it('populates commandDefsMap from array items', () => {
      const schema = makeSchema({ state, events, commands: [createTodo, completeTodo] })

      expect(schema.commandDefsMap.size).toBe(2)
      expect(schema.commandDefsMap.has('CreateTodo')).toBe(true)
      expect(schema.commandDefsMap.has('CompleteTodo')).toBe(true)
    })
  })

  describe('commands omitted', () => {
    it('produces an empty commandDefsMap when commands is undefined', () => {
      const schema = makeSchema({ state, events })

      expect(schema.commandDefsMap).toBeInstanceOf(Map)
      expect(schema.commandDefsMap.size).toBe(0)
    })
  })

  describe('duplicate command names', () => {
    it('throws on duplicate names in a record', () => {
      const duplicateCreate = defineCommand({
        name: 'CreateTodo',
        schema: Schema.Struct({ id: Schema.String }),
        handler: () => [],
      })

      expect(() =>
        makeSchema({ state, events, commands: { a: createTodo, b: duplicateCreate } }),
      ).toThrow(/Duplicate command name: CreateTodo/)
    })

    it('throws on duplicate names in an array', () => {
      const duplicateCreate = defineCommand({
        name: 'CreateTodo',
        schema: Schema.Struct({ id: Schema.String }),
        handler: () => [],
      })

      expect(() =>
        makeSchema({ state, events, commands: [createTodo, duplicateCreate] }),
      ).toThrow(/Duplicate command name: CreateTodo/)
    })
  })
})

describe('isLiveStoreSchema', () => {
  it('accepts a schema produced by makeSchema', () => {
    const schema = makeSchema({ state, events, commands: { createTodo } })
    expect(isLiveStoreSchema(schema)).toBe(true)
  })

  it('accepts a schema without commands', () => {
    const schema = makeSchema({ state, events })
    expect(isLiveStoreSchema(schema)).toBe(true)
  })

  it('rejects plain objects', () => {
    expect(isLiveStoreSchema({})).toBe(false)
    expect(isLiveStoreSchema({ commandDefsMap: new Map() })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isLiveStoreSchema(null)).toBe(false)
    expect(isLiveStoreSchema(42)).toBe(false)
    expect(isLiveStoreSchema('schema')).toBe(false)
  })
})
