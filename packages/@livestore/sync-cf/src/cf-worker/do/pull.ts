import { SyncBackend, type UnexpectedError } from '@livestore/common'
import { Effect, identity, pipe, ReadonlyArray, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import { PULL_CHUNK_SIZE } from '../shared.ts'
import type { SyncStorage } from './sync-storage.ts'

export const makePull =
  ({ storage }: { storage: SyncStorage }) =>
  (req: SyncMessage.PullRequest): Stream.Stream<SyncMessage.PullResponse, UnexpectedError> =>
    Effect.gen(function* () {
      // TODO use streaming
      const remainingEvents = yield* storage.getEvents(req.cursor)

      const batches = pipe(
        remainingEvents,
        ReadonlyArray.chunksOf(PULL_CHUNK_SIZE),
        ReadonlyArray.map((batch, i) => {
          const remaining = Math.max(0, remainingEvents.length - (i + 1) * PULL_CHUNK_SIZE)

          return SyncMessage.PullResponse.make({
            batch,
            pageInfo: remaining > 0 ? SyncBackend.pageInfoMoreKnown(remaining) : SyncBackend.pageInfoNoMore,
          })
        }),
      )

      // For live pull, we need to return a no-more page info if there are no more events
      if (remainingEvents.length === 0 && req.live) {
        return Stream.make(
          SyncMessage.PullResponse.make({
            batch: [],
            pageInfo: SyncBackend.pageInfoNoMore,
          }),
        )
      }

      return Stream.fromIterable(batches)
    }).pipe(
      Stream.unwrap,
      // Needed to keep the stream alive
      req.live ? Stream.concat(Stream.never) : identity,
      Stream.withSpan('cloudflare-provider:pull'),
    )
