import { BackendIdMismatchError, InvalidPullError, SyncBackend, UnexpectedError } from '@livestore/common'
import { Effect, Option, pipe, ReadonlyArray, type Schema, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import { PULL_CHUNK_SIZE } from '../shared.ts'
import { DoCtx } from './layer.ts'

// Notes on stream handling:
// We're intentionally closing the stream once we've read all existing events
//
// WebSocket:
// - Further chunks will be emitted manually in `push.ts`
// - If the client sends a `Interrupt` RPC message, it will be handled in the `durable-object.ts` constructor
// DO RPC:
// - Further chunks will be emitted manually in `push.ts`
// - If the client sends a `Interrupt` RPC message, TODO
export const makeEndingPullStream = (
  req: SyncMessage.PullRequest,
  payload: Schema.JsonValue | undefined,
): Stream.Stream<SyncMessage.PullResponse, InvalidPullError, DoCtx> =>
  Effect.gen(function* () {
    const { doOptions, backendId, storeId, storage } = yield* DoCtx

    if (doOptions?.onPull) {
      yield* Effect.tryAll(() => doOptions!.onPull!(req, { storeId, payload })).pipe(
        UnexpectedError.mapToUnexpectedError,
      )
    }

    if (req.cursor._tag === 'Some' && req.cursor.value.backendId !== backendId) {
      return yield* new BackendIdMismatchError({ expected: backendId, received: req.cursor.value.backendId })
    }

    // TODO use streaming for db results
    const remainingEvents = yield* storage.getEvents(Option.getOrUndefined(req.cursor)?.eventSequenceNumber)

    const batches = pipe(
      remainingEvents,
      ReadonlyArray.chunksOf(PULL_CHUNK_SIZE),
      ReadonlyArray.map((batch, i) => {
        const remaining = Math.max(0, remainingEvents.length - (i + 1) * PULL_CHUNK_SIZE)

        return SyncMessage.PullResponse.make({
          batch,
          pageInfo: remaining > 0 ? SyncBackend.pageInfoMoreKnown(remaining) : SyncBackend.pageInfoNoMore,
          backendId,
        })
      }),
    )

    return Stream.fromIterable(batches).pipe(
      Stream.tap(
        Effect.fn(function* (res) {
          if (doOptions?.onPullRes) {
            yield* Effect.tryAll(() => doOptions.onPullRes!(res)).pipe(UnexpectedError.mapToUnexpectedError)
          }
        }),
      ),
      Stream.emitIfEmpty(SyncMessage.emptyPullResponse(backendId)),
    )
  }).pipe(
    Stream.unwrap,
    Stream.mapError((cause) => InvalidPullError.make({ cause })),
    Stream.withSpan('cloudflare-provider:pull'),
  )
