import { Array, Effect, STM, TRef } from 'effect'

export type BucketQueue<A> = TRef.TRef<A[]>

export const make = <A>(): STM.STM<BucketQueue<A>> => TRef.make<A[]>([])

export const offerAll = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) =>
  TRef.update(self, (bucket) => Array.appendAll(bucket, elements))

export const replace = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) => TRef.set(self, elements as A[])

export const clear = <A>(self: BucketQueue<A>) => TRef.set(self, [])

export const takeBetween = <A>(
  bucket: BucketQueue<A>,
  min: number,
  max: number,
): STM.STM<ReadonlyArray<A>, never, never> =>
  STM.gen(function* () {
    const bucketValue = yield* TRef.get(bucket)
    if (bucketValue.length < min) {
      return yield* STM.retry
    } else {
      const elements = bucketValue.splice(0, Math.min(max, bucketValue.length))
      yield* TRef.set(bucket, bucketValue)
      return elements
    }
  })

export const peekAll = <A>(bucket: BucketQueue<A>) => TRef.get(bucket)

/** Returns the elements up to the first element that matches the predicate, the rest is left in the queue
 *
 * @example
 * ```ts
 * const [elements, rest] = yield* BucketQueue.takeSplitWhere(bucket, (a) => a > 3)
 * assert.deepStrictEqual(elements, [1, 2, 3])
 * assert.deepStrictEqual(rest, [4, 5, 6])
 * ```
 */
export const takeSplitWhere = <A>(bucket: BucketQueue<A>, predicate: (a: A) => boolean) =>
  STM.gen(function* () {
    const bucketValue = yield* TRef.get(bucket)
    const [elements, rest] = Array.splitWhere(bucketValue, predicate)
    yield* TRef.set(bucket, rest)
    return elements
  })

export const size = <A>(bucket: BucketQueue<A>) => TRef.get(bucket).pipe(Effect.map((_) => _.length))
