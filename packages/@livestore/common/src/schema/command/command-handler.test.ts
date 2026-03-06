import { describe, expect, it } from 'vitest'

import type { SqliteDb } from '../../adapter-types.ts'
import { executeCommandHandler } from './command-handler.ts'

describe('executeCommandHandler', () => {
  const stubDb = { select: () => [] } as unknown as SqliteDb

  it('returns ok for a single event', () => {
    const result = executeCommandHandler({
      handler: () => ({
        name: 'TodoCreated',
        args: { id: 'todo-1' },
      }),
      commandArgs: {},
      db: stubDb,
      phaseTag: 'initial',
    })

    expect(result).toEqual({
      _tag: 'ok',
      events: [{ name: 'TodoCreated', args: { id: 'todo-1' } }],
    })
  })

  it('returns ok for an event array', () => {
    const result = executeCommandHandler({
      handler: () => [
        { name: 'TodoCreated', args: { id: 'todo-1' } },
        { name: 'TodoCompleted', args: { id: 'todo-1' } },
      ],
      commandArgs: {},
      db: stubDb,
      phaseTag: 'initial',
    })

    expect(result).toEqual({
      _tag: 'ok',
      events: [
        { name: 'TodoCreated', args: { id: 'todo-1' } },
        { name: 'TodoCompleted', args: { id: 'todo-1' } },
      ],
    })
  })

  it('returns error for recoverable handler values', () => {
    const result = executeCommandHandler({
      handler: () => ({ _tag: 'RoomAtCapacity', roomId: 'room-1' }),
      commandArgs: {},
      db: stubDb,
      phaseTag: 'initial',
    })

    expect(result).toEqual({
      _tag: 'error',
      error: { _tag: 'RoomAtCapacity', roomId: 'room-1' },
    })
  })

  it('returns threw for unexpected exceptions', () => {
    const cause = new Error('boom')
    const result = executeCommandHandler({
      handler: () => {
        throw cause
      },
      commandArgs: {},
      db: stubDb,
      phaseTag: 'initial',
    })

    expect(result).toEqual({
      _tag: 'threw',
      cause,
    })
  })

  it('passes "replay" phase to handler context', () => {
    let receivedPhase: { _tag: string } | undefined
    executeCommandHandler({
      handler: (_args, ctx) => {
        receivedPhase = ctx.phase
        return { name: 'TodoCreated', args: { id: 'todo-1' } }
      },
      commandArgs: {},
      db: stubDb,
      phaseTag: 'replay',
    })

    expect(receivedPhase).toEqual({ _tag: 'replay' })
  })
})
