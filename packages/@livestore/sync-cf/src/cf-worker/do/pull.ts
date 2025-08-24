import { SyncBackend, UnexpectedError } from '@livestore/common'
import { Effect, pipe, ReadonlyArray, type Schema, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import { type MakeDurableObjectClassOptions, PULL_CHUNK_SIZE, type StoreId } from '../shared.ts'
import type { SyncStorage } from './sync-storage.ts'

// Notes on stream handling:
// We're intentionally closing the stream once we've read all existing events
//
// WebSocket:
// - Further chunks will be emitted manually in `push.ts`
// - If the client sends a `Interrupt` RPC message, it will be handled in the `durable-object.ts` constructor
// DO RPC:
// - Further chunks will be emitted manually in `push.ts`
// - If the client sends a `Interrupt` RPC message, TODO
export const makeEndingPullStream =
  ({
    storage,
    doOptions,
    storeId,
    payload,
  }: {
    storage: SyncStorage
    doOptions: MakeDurableObjectClassOptions | undefined
    storeId: StoreId
    payload: Schema.JsonValue | undefined
  }) =>
  (req: SyncMessage.PullRequest): Stream.Stream<SyncMessage.PullResponse, UnexpectedError> =>
    Effect.gen(function* () {
      if (doOptions?.onPull) {
        yield* Effect.tryAll(() => doOptions!.onPull!(req, { storeId, payload })).pipe(
          UnexpectedError.mapToUnexpectedError,
        )
      }

      // TODO use streaming for db results
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

      return Stream.fromIterable(batches)
    }).pipe(Stream.unwrap, Stream.withSpan('cloudflare-provider:pull'))
