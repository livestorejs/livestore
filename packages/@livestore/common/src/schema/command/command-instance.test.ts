import { describe, expect, it } from 'vitest'
import { Schema } from '@livestore/utils/effect'

import { CommandInstanceSchema, isCommandInstance, makeCommandInstance } from './command-instance.ts'

describe('makeCommandInstance', () => {
  it('creates a branded instance with name, args, and prefixed id', () => {
    const instance = makeCommandInstance({ name: 'CheckIn', args: { roomId: 'room-1' } })

    expect(instance.name).toBe('CheckIn')
    expect(instance.args).toEqual({ roomId: 'room-1' })
    expect(instance.id).toMatch(/^cmd_/)
    expect(isCommandInstance(instance)).toBe(true)
  })
})

describe('isCommandInstance', () => {
  it('accepts branded instances', () => {
    const instance = makeCommandInstance({ name: 'Test', args: {} })
    expect(isCommandInstance(instance)).toBe(true)
  })

  it('rejects plain objects with matching shape', () => {
    expect(isCommandInstance({ name: 'Foo', args: {}, id: 'cmd_fake' })).toBe(false)
  })

  it('rejects primitives', () => {
    expect(isCommandInstance(null)).toBe(false)
    expect(isCommandInstance(undefined)).toBe(false)
    expect(isCommandInstance(42)).toBe(false)
    expect(isCommandInstance('string')).toBe(false)
  })
})

describe('CommandInstanceSchema', () => {
  it('round-trips through encode and decode', () => {
    const instance = makeCommandInstance({ name: 'CreateTodo', args: { id: 'todo-1', text: 'Buy milk' } })

    const encoded = Schema.encodeSync(CommandInstanceSchema)(instance)
    expect(encoded).toEqual({ id: instance.id, name: 'CreateTodo', args: { id: 'todo-1', text: 'Buy milk' } })

    const decoded = Schema.decodeSync(CommandInstanceSchema)(encoded)
    expect(decoded.name).toBe('CreateTodo')
    expect(decoded.args).toEqual({ id: 'todo-1', text: 'Buy milk' })
    expect(decoded.id).toBe(instance.id)
    expect(isCommandInstance(decoded)).toBe(true)
  })
})
