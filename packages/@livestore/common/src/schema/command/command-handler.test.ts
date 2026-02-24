import { describe, expect, it } from 'vitest'

import { executeCommandHandler } from './command-handler.ts'

describe('executeCommandHandler', () => {
  const initialContext = {
    query: () => [],
    phase: { _tag: 'initial' as const },
  }

  it('returns ok for a single event', () => {
    const result = executeCommandHandler(
      () => ({
        name: 'TodoCreated',
        args: { id: 'todo-1' },
      }),
      {},
      initialContext,
    )

    expect(result).toEqual({
      _tag: 'ok',
      events: [{ name: 'TodoCreated', args: { id: 'todo-1' } }],
    })
  })

  it('returns ok for an event array', () => {
    const result = executeCommandHandler(
      () => [
        { name: 'TodoCreated', args: { id: 'todo-1' } },
        { name: 'TodoCompleted', args: { id: 'todo-1' } },
      ],
      {},
      initialContext,
    )

    expect(result).toEqual({
      _tag: 'ok',
      events: [
        { name: 'TodoCreated', args: { id: 'todo-1' } },
        { name: 'TodoCompleted', args: { id: 'todo-1' } },
      ],
    })
  })

  it('returns error for recoverable handler values', () => {
    const result = executeCommandHandler(
      () => ({ _tag: 'RoomAtCapacity', roomId: 'room-1' }),
      {},
      initialContext,
    )

    expect(result).toEqual({
      _tag: 'error',
      error: { _tag: 'RoomAtCapacity', roomId: 'room-1' },
    })
  })

  it('returns threw for unexpected exceptions', () => {
    const cause = new Error('boom')
    const result = executeCommandHandler(
      () => {
        throw cause
      },
      {},
      initialContext,
    )

    expect(result).toEqual({
      _tag: 'threw',
      cause,
    })
  })

  it('passes "replay" phase to handler context', () => {
    const replayContext = {
      query: () => [],
      phase: { _tag: 'replay' as const },
    }

    let receivedPhase: { _tag: string } | undefined
    executeCommandHandler(
      (_args, ctx) => {
        receivedPhase = ctx.phase
        return { name: 'TodoCreated', args: { id: 'todo-1' } }
      },
      {},
      replayContext,
    )

    expect(receivedPhase).toEqual({ _tag: 'replay' })
  })
})
