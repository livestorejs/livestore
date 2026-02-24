import { describe, expect, it } from 'vitest'
import { Schema } from '@livestore/utils/effect'

import { defineCommand } from './command-def.ts'
import { isCommandInstance } from './command-instance.ts'

describe('defineCommand', () => {
  const testSchema = Schema.Struct({ id: Schema.String, text: Schema.String })

  const cmd = defineCommand({
    name: 'CreateTodo',
    schema: testSchema,
    handler: ({ id, text }) => ({ name: 'TodoCreated', args: { id, text } }),
  })

  it('returns a callable with name, schema, and handler properties', () => {
    expect(typeof cmd).toBe('function')
    expect(cmd.name).toBe('CreateTodo')
    expect(cmd.schema).toBe(testSchema)
    expect(typeof cmd.handler).toBe('function')
  })

  it('creates a CommandInstance when called', () => {
    const instance = cmd({ id: 'todo-1', text: 'Buy milk' })

    expect(instance.name).toBe('CreateTodo')
    expect(instance.args).toEqual({ id: 'todo-1', text: 'Buy milk' })
    expect(instance.id).toMatch(/^cmd_/)
    expect(isCommandInstance(instance)).toBe(true)
  })

  it('generates unique IDs per invocation', () => {
    const a = cmd({ id: 'todo-1', text: 'A' })
    const b = cmd({ id: 'todo-2', text: 'B' })

    expect(a.id).not.toBe(b.id)
  })

  it('throws on invalid args', () => {
    expect(() => (cmd as any)({ id: 123 })).toThrow()
  })
})
