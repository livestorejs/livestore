import { BackendIdMismatchError, InvalidPullError, SyncBackend, UnexpectedError } from '@livestore/common'
import { splitChunkBySize } from '@livestore/common/sync'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'
import { MAX_PULL_EVENTS_PER_MESSAGE, MAX_WS_MESSAGE_BYTES } from '../../common/constants.ts'
import { SyncMessage } from '../../common/mod.ts'
import { DoCtx } from './layer.ts'

const encodePullResponse = Schema.encodeSync(SyncMessage.PullResponse)

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

    const { stream: storedEvents, total } = yield* storage.getEvents(
      Option.getOrUndefined(req.cursor)?.eventSequenceNumber,
    )

    return storedEvents.pipe(
      Stream.mapChunksEffect(
        splitChunkBySize({
          maxItems: MAX_PULL_EVENTS_PER_MESSAGE,
          maxBytes: MAX_WS_MESSAGE_BYTES,
          encode: (batch) =>
            encodePullResponse(
              SyncMessage.PullResponse.make({ batch, pageInfo: SyncBackend.pageInfoNoMore, backendId }),
            ),
        }),
      ),
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
