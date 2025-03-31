import { Effect, Queue } from '@livestore/utils/effect'

import { getMutationEventsSince } from './mutationlog.js'
import { LeaderThreadCtx, type PullQueueItem, type PullQueueSet } from './types.js'

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

      const newEvents = yield* getMutationEventsSince(since)

      if (newEvents.length > 0) {
        yield* queue.offer({ payload: { _tag: 'upstream-advance', newEvents }, remaining: 0 })
      }

      set.add(queue)

      return queue
    })

  const offer: PullQueueSet['offer'] = (item) =>
    Effect.gen(function* () {
      // Short-circuit if the payload is an empty upstream advance
      if (item.payload._tag === 'upstream-advance' && item.payload.newEvents.length === 0) {
        return
      }

      const { clientId } = yield* LeaderThreadCtx
      if (clientId === 'client-b') {
        // console.log(
        //   'offer',
        //   item.payload._tag,
        //   item.payload.newEvents.map((_) => _.toJSON()),
        // )
      }

      for (const queue of set) {
        yield* Queue.offer(queue, item)
      }
    })

  return {
    makeQueue,
    offer,
  }
})
