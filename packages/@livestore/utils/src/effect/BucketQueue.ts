import { Array, Effect, TxRef } from 'effect'

export type BucketQueue<A> = TxRef.TxRef<A[]>

export const make = <A>(): Effect.Effect<BucketQueue<A>> => TxRef.make<A[]>([])

export const offerAll = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) =>
  TxRef.update(self, (bucket) => Array.appendAll(bucket, elements))

export const replace = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) => TxRef.set(self, elements as A[])

export const clear = <A>(self: BucketQueue<A>) => TxRef.set(self, [])

export const takeBetween = <A>(bucket: BucketQueue<A>, min: number, max: number): Effect.Effect<ReadonlyArray<A>> =>
  Effect.tx(Effect.gen(function* () {
    const bucketValue = yield* TxRef.get(bucket)
    if (bucketValue.length < min) {
      return yield* Effect.txRetry
    } else {
      const elements = bucketValue.splice(0, Math.min(max, bucketValue.length))
      yield* TxRef.set(bucket, bucketValue)
      return elements
    }
  }))

export const peekAll = <A>(bucket: BucketQueue<A>) => TxRef.get(bucket)

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
  Effect.tx(Effect.gen(function* () {
    const bucketValue = yield* TxRef.get(bucket)
    const [elements, rest] = Array.splitWhere(bucketValue, predicate)
    yield* TxRef.set(bucket, rest)
    return elements
  }))

export const size = <A>(bucket: BucketQueue<A>) => TxRef.get(bucket).pipe(Effect.map((_) => _.length))
