import { Effect, Option, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { concatWithLastElement, runCollectReadonlyArray } from './Stream.ts'

describe('concatWithLastElement', () => {
  it('should concatenate streams with access to last element of first stream', async () => {
    const stream1 = Stream.make(1, 2, 3)
    const result = concatWithLastElement(stream1, (lastElement) =>
      lastElement.pipe(
        Option.match({
          onNone: () => Stream.make('no-previous'),
          onSome: (last) => Stream.make(`last-was-${last}`, 'continuing'),
        }),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual([1, 2, 3, 'last-was-3', 'continuing'])
  })

  it('should handle empty first stream', async () => {
    const stream1 = Stream.empty
    const result = concatWithLastElement(stream1, (lastElement) =>
      lastElement.pipe(
        Option.match({
          onNone: () => Stream.make('no-previous-element'),
          onSome: (last) => Stream.make(`last-was-${last}`),
        }),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual(['no-previous-element'])
  })

  it('should handle single element first stream', async () => {
    const stream1 = Stream.make('single')
    const result = concatWithLastElement(stream1, (lastElement) =>
      lastElement.pipe(
        Option.match({
          onNone: () => Stream.make('unexpected'),
          onSome: (last) => Stream.make(`after-${last}`),
        }),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual(['single', 'after-single'])
  })

  it('should handle empty second stream', async () => {
    const stream1 = Stream.make(1, 2, 3)
    const result = concatWithLastElement(stream1, () => Stream.empty)

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual([1, 2, 3])
  })

  it('should preserve error handling from first stream', async () => {
    const stream1 = Stream.fail('first-error')
    const result = concatWithLastElement(stream1, () => Stream.make('should-not-reach'))

    const outcome = await Effect.runPromise(Effect.either(runCollectReadonlyArray(result)))
    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left).toBe('first-error')
    }
  })

  it('should preserve error handling from second stream', async () => {
    const stream1 = Stream.make(1, 2)
    const result = concatWithLastElement(stream1, () => Stream.fail('second-error'))

    const outcome = await Effect.runPromise(Effect.either(runCollectReadonlyArray(result)))
    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left).toBe('second-error')
    }
  })

  it('should work with different types in streams', async () => {
    const stream1 = Stream.make(1, 2, 3)
    const result = concatWithLastElement(stream1, (lastElement) =>
      lastElement.pipe(
        Option.match({
          onNone: () => Stream.make('no-number') as Stream.Stream<number | string, never, never>,
          onSome: (last) => Stream.make(last * 10, last * 100),
        }),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual([1, 2, 3, 30, 300])
  })

  it('should handle async effects in streams', async () => {
    const stream1 = Stream.fromEffect(Effect.succeed('async-value'))
    const result = concatWithLastElement(stream1, (lastElement) =>
      lastElement.pipe(
        Option.match({
          onNone: () => Stream.fromEffect(Effect.succeed('no-async')),
          onSome: (last) => Stream.fromEffect(Effect.succeed(`processed-${last}`)),
        }),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual(['async-value', 'processed-async-value'])
  })

  it('should work with dual function - piped style', async () => {
    const stream1 = Stream.make('a', 'b', 'c')
    const result = stream1.pipe(
      concatWithLastElement((lastElement) =>
        lastElement.pipe(
          Option.match({
            onNone: () => Stream.make('no-last'),
            onSome: (last) => Stream.make(`last-${last}`, 'done'),
          }),
        ),
      ),
    )

    const collected = await Effect.runPromise(runCollectReadonlyArray(result))
    expect(collected).toEqual(['a', 'b', 'c', 'last-c', 'done'])
  })
})
