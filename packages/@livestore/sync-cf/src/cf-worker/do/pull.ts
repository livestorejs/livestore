import { BackendIdMismatchError, InvalidPullError, SyncBackend, UnexpectedError } from '@livestore/common'
import { Chunk, Effect, Option, pipe, type Schema, Stream } from '@livestore/utils/effect'
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

    const { stream: storedBatches, total } = yield* storage.getEvents(
      Option.getOrUndefined(req.cursor)?.eventSequenceNumber,
    )

    return storedBatches.pipe(
      Stream.flatMap((batch) => Stream.fromIterable(batch)),
      Stream.grouped(PULL_CHUNK_SIZE),
      Stream.mapAccum(total, (remaining, chunk) => {
        const asArray = Chunk.toReadonlyArray(chunk)
        const nextRemaining = Math.max(0, remaining - asArray.length)

        return [
          nextRemaining,
          SyncMessage.PullResponse.make({
            batch: asArray,
            pageInfo: nextRemaining > 0 ? SyncBackend.pageInfoMoreKnown(nextRemaining) : SyncBackend.pageInfoNoMore,
            backendId,
          }),
        ] as const
      }),
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
