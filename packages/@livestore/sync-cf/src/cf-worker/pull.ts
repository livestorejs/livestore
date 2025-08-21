import { Effect, identity, pipe, ReadonlyArray, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../common/mod.ts'
import { PULL_CHUNK_SIZE } from './shared.ts'
import type { SyncStorage } from './sync-storage.ts'

export const makePull =
  ({ storage }: { storage: SyncStorage }) =>
  (req: Omit<SyncMessage.PullRequest, '_tag'>) =>
    Effect.gen(function* () {
      // TODO use streaming
      const remainingEvents = yield* storage.getEvents(req.cursor)

      const batches = pipe(
        remainingEvents,
        ReadonlyArray.chunksOf(PULL_CHUNK_SIZE),
        ReadonlyArray.map((batch, i) =>
          SyncMessage.PullResponse.make({
            batch,
            remaining: Math.max(0, remainingEvents.length - (i + 1) * PULL_CHUNK_SIZE),
            requestId: { context: 'pull', requestId: req.requestId },
          }),
        ),
      )

      return Stream.fromIterable(batches).pipe(
        // Needed to keep the stream alive
        req.live ? Stream.concat(Stream.never) : identity,
      )
    }).pipe(Stream.unwrap)
