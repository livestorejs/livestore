import { describe, expect, expectTypeOf, it } from '@effect/vitest'
import { Cause, Effect } from 'effect'

import { trySyncOrPromiseOrEffect } from './Effect.ts'

interface RequiredService {
  readonly RequiredService: unique symbol
}

declare const contextualEffect: Effect.Effect<number, 'effect-error', RequiredService>

describe('trySyncOrPromiseOrEffect', () => {
  it.effect('returns a plain value', () =>
    Effect.gen(function* () {
      const result = yield* trySyncOrPromiseOrEffect(() => 42 as const)

      expect(result).toBe(42)
    }),
  )

  it.effect('evaluates the operation lazily for each execution', () =>
    Effect.gen(function* () {
      let executions = 0
      const effect = trySyncOrPromiseOrEffect(() => ++executions)

      expect(executions).toBe(0)
      expect(yield* effect).toBe(1)
      expect(yield* effect).toBe(2)
    }),
  )

  it.effect('maps a synchronous throw to an UnknownError', () =>
    Effect.gen(function* () {
      const thrown = new Error('thrown')
      const failure = yield* trySyncOrPromiseOrEffect(() => {
        throw thrown
      }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Cause.UnknownError)
      if (failure instanceof Cause.UnknownError) {
        expect(failure.cause).toBe(thrown)
      }
    }),
  )

  it.effect('awaits a resolving Promise', () =>
    Effect.gen(function* () {
      const result = yield* trySyncOrPromiseOrEffect(() => Promise.resolve('resolved'))

      expect(result).toBe('resolved')
    }),
  )

  it.effect('maps a rejected Promise to an UnknownError', () =>
    Effect.gen(function* () {
      const rejected = new Error('rejected')
      const failure = yield* trySyncOrPromiseOrEffect(() => Promise.reject(rejected)).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Cause.UnknownError)
      if (failure instanceof Cause.UnknownError) {
        expect(failure.cause).toBe(rejected)
      }
    }),
  )

  it.effect('maps a throwing Promise-like then getter to an UnknownError', () =>
    Effect.gen(function* () {
      const thrown = new Error('throwing then getter')
      const thenable = {
        // oxlint-disable-next-line eslint-plugin-unicorn(no-thenable) -- intentionally exercises Promise-like classification
        get then(): PromiseLike<never>['then'] {
          throw thrown
        },
      } satisfies PromiseLike<never>

      const failure = yield* trySyncOrPromiseOrEffect(() => thenable).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Cause.UnknownError)
      if (failure instanceof Cause.UnknownError) {
        expect(failure.cause).toBe(thrown)
      }
    }),
  )

  it.effect('executes and returns the value of a returned Effect', () =>
    Effect.gen(function* () {
      const result = yield* trySyncOrPromiseOrEffect(() => Effect.succeed('effect-value'))

      expect(result).toBe('effect-value')
    }),
  )

  it.effect('preserves a returned Effect failure', () =>
    Effect.gen(function* () {
      const expected = { _tag: 'ExpectedError' as const }
      const failure = yield* trySyncOrPromiseOrEffect(() => Effect.fail(expected)).pipe(Effect.flip)

      expect(failure).toBe(expected)
    }),
  )

  it('preserves returned Effect success, error, and requirements types', () => {
    const normalized = trySyncOrPromiseOrEffect(() => contextualEffect)

    expectTypeOf(normalized).toEqualTypeOf<
      Effect.Effect<number, 'effect-error' | Cause.UnknownError, RequiredService>
    >()
  })

  it('returns an Effect when the operation only throws', () => {
    const normalized = trySyncOrPromiseOrEffect((): never => {
      throw new Error('thrown')
    })

    expectTypeOf(normalized).toEqualTypeOf<Effect.Effect<never, Cause.UnknownError>>()
  })
})
