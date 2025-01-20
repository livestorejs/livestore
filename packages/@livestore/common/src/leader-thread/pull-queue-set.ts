import { Effect, Queue } from '@livestore/utils/effect'

import { MutationEventEncodedWithDeferred } from '../sync/syncstate.js'
import { getMutationEventsSince } from './mutationlog.js'
import { type PullQueueItem, type PullQueueSet } from './types.js'

export const makePullQueueSet = Effect.gen(function* () {
  const set = new Set<Queue.Queue<PullQueueItem>>()

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const queue of set) {
        yield* Queue.shutdown(queue)
      }

      set.clear()
    }),
  )

  const makeQueue: PullQueueSet['makeQueue'] = (since) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<PullQueueItem>().pipe(Effect.acquireRelease(Queue.shutdown))

      yield* Effect.addFinalizer(() => Effect.sync(() => set.delete(queue)))

      const mutationEvents = yield* getMutationEventsSince(since)

      // const { syncProcessor } = yield* LeaderThreadCtx

      // TODO remove backendHead
      yield* queue.offer({
        payload: {
          _tag: 'upstream-advance',
          newEvents: mutationEvents.map((mutationEvent) => new MutationEventEncodedWithDeferred(mutationEvent)),
        },
        remaining: 0,
      })

      set.add(queue)

      return queue
    })

  return {
    makeQueue,
    [Symbol.iterator]: () => set[Symbol.iterator](),
  }
})
