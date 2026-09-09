import { describe, expect, it } from '@effect/vitest'
import { Effect } from '@livestore/utils/effect'

import { makePresenceRateLimiter } from './rate-limit.ts'

describe('presence rate limiter', () => {
  it('allows every update when unconfigured', () =>
    Effect.gen(function* () {
      const limiter = makePresenceRateLimiter(undefined)
      yield* limiter.check('alice')
      yield* limiter.check('alice')
    }))

  it('accepts the first update and rejects the next inside the window', () =>
    Effect.gen(function* () {
      const limiter = makePresenceRateLimiter({ minIntervalMs: 1_000 })
      yield* limiter.check('alice')
      const second = yield* limiter.check('alice').pipe(Effect.result)
      expect(second._tag).toBe('Failure')
      if (second._tag === 'Failure') {
        expect(second.failure._tag).toBe('PresenceRateLimited')
        expect(second.failure.clientId).toBe('alice')
      }
    }))

  it('tracks clients independently', () =>
    Effect.gen(function* () {
      const limiter = makePresenceRateLimiter({ minIntervalMs: 1_000 })
      yield* limiter.check('alice')
      yield* limiter.check('bob')
    }))

  it('allows another update after the window', () =>
    Effect.gen(function* () {
      const limiter = makePresenceRateLimiter({ minIntervalMs: 5 })
      yield* limiter.check('alice')
      yield* Effect.sleep(10)
      yield* limiter.check('alice')
    }))

  it('forget clears the window so the next update is accepted', () =>
    Effect.gen(function* () {
      const limiter = makePresenceRateLimiter({ minIntervalMs: 1_000 })
      yield* limiter.check('alice')
      limiter.forget('alice')
      yield* limiter.check('alice')
    }))

  it('defaults onExceed to ignore', () => {
    const limiter = makePresenceRateLimiter({ minIntervalMs: 10 })
    expect(limiter.onExceed).toBe('ignore')
  })

  it('honors onExceed: close', () => {
    const limiter = makePresenceRateLimiter({ minIntervalMs: 10, onExceed: 'close' })
    expect(limiter.onExceed).toBe('close')
  })
})
