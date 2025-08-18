import { Effect, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../common/mod.ts'
import { PULL_CHUNK_SIZE } from './shared.ts'
import type { SyncStorage } from './sync-storage.ts'

export const makePull =
  ({ storage }: { storage: SyncStorage }) =>
  (req: Omit<SyncMessage.PullRequest, '_tag'>) =>
    Effect.gen(function* () {
      // TODO use streaming
      const remainingEvents = yield* storage.getEvents(req.cursor)

      // const batches = (
      //   remainingEvents.length === 0
      //     ? // Send at least one response, even if there are no events
      //       ([[]] as never)
      //     :
      const batches = Array.from({ length: Math.ceil(remainingEvents.length / PULL_CHUNK_SIZE) }, (_, i) =>
        remainingEvents.slice(i * PULL_CHUNK_SIZE, (i + 1) * PULL_CHUNK_SIZE),
      ).map((batch, i) =>
        SyncMessage.PullResponse.make({
          batch,
          remaining: Math.max(0, remainingEvents.length - (i + 1) * PULL_CHUNK_SIZE),
          requestId: { context: 'pull', requestId: req.requestId },
        }),
      )

      return Stream.fromIterable(batches)
    }).pipe(Stream.unwrap)
