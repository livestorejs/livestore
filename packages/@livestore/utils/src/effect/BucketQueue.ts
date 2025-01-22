import { Array, STM, TRef } from 'effect'

export type BucketQueue<A> = TRef.TRef<A[]>

export const make = <A>(): STM.STM<BucketQueue<A>> => TRef.make<A[]>([])

export const offerAll = <A>(self: BucketQueue<A>, elements: ReadonlyArray<A>) =>
  TRef.update(self, (bucket) => Array.appendAll(bucket, elements))

export const clear = <A>(self: BucketQueue<A>) => TRef.set(self, [])

export const takeBetween = <A>(self: BucketQueue<A>, min: number, max: number) =>
  STM.gen(function* () {
    const bucket = yield* TRef.get(self)
    if (bucket.length < min) {
      return yield* STM.retry
    } else {
      const elements = bucket.splice(0, Math.min(max, bucket.length))
      yield* TRef.set(self, bucket)
      return elements
    }
  })
