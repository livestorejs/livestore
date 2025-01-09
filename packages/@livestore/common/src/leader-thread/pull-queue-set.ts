import type { Scope } from '@livestore/utils/effect'
import { Effect, Queue } from '@livestore/utils/effect'

import type { EventId, UnexpectedError } from '../adapter-types.js'
import { getMutationEventsSince } from './mutationlog.js'
import type { LeaderThreadCtx, PullQueueItem } from './types.js'

export interface PullQueueSet extends Iterable<Queue.Queue<PullQueueItem>> {
  makeQueue: (
    since: EventId,
  ) => Effect.Effect<Queue.Queue<PullQueueItem>, UnexpectedError, Scope.Scope | LeaderThreadCtx>
}

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

      yield* queue.offer({ mutationEvents, remaining: 0 })

      set.add(queue)

      return queue
    })

  return {
    makeQueue,
    [Symbol.iterator]: () => set[Symbol.iterator](),
  }
})
