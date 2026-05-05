import { Array, Effect, Queue, Ref } from 'effect'

export type BucketQueue<A> = {
  readonly queue: Queue.Queue<A>
  readonly items: Ref.Ref<ReadonlyArray<A>>
}

export const make = <A>(): Effect.Effect<BucketQueue<A>> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<A>()
    const items = yield* Ref.make<ReadonlyArray<A>>([])
    return { queue, items }
  })

export const offerAll = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) =>
  Ref.update(self.items, (bucket) => Array.appendAll(bucket, elements)).pipe(
    Effect.zipRight(Queue.offerAll(self.queue, elements)),
  )

export const replace = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) =>
  Queue.takeAll(self.queue).pipe(
    Effect.ignore,
    Effect.zipRight(Ref.set(self.items, elements)),
    Effect.zipRight(Queue.offerAll(self.queue, elements)),
  )

export const clear = <A>(self: BucketQueue<A>) =>
  Queue.takeAll(self.queue).pipe(Effect.ignore, Effect.zipRight(Ref.set(self.items, [])))

export const takeBetween = <A>(
  bucket: BucketQueue<A>,
  min: number,
  max: number,
): Effect.Effect<ReadonlyArray<A>> =>
  Effect.gen(function* () {
    const elements = yield* Queue.takeBetween(bucket.queue, min, max)
    yield* Ref.update(bucket.items, (bucketValue) => bucketValue.slice(elements.length))
    return elements
  })

export const peekAll = <A>(bucket: BucketQueue<A>) => Ref.get(bucket.items)

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
  Effect.gen(function* () {
    const [elements, rest] = yield* Ref.modify(bucket.items, (bucketValue) => {
      const [elements, rest] = Array.splitWhere(bucketValue, predicate)
      return [elements, rest] as const
    })
    if (elements.length > 0) {
      yield* Queue.takeAll(bucket.queue).pipe(Effect.ignore)
      yield* Queue.offerAll(bucket.queue, rest)
    }
    return elements
  })

export const size = <A>(bucket: BucketQueue<A>) => Ref.get(bucket.items).pipe(Effect.map((_) => _.length))
