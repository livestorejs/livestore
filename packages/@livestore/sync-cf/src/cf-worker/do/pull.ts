import { BackendIdMismatchError, SyncBackend, UnknownError } from '@livestore/common'
import { splitChunkBySize } from '@livestore/common/sync'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { MAX_PULL_EVENTS_PER_MESSAGE, MAX_WS_MESSAGE_BYTES } from '../../common/constants.ts'
import { SyncMessage } from '../../common/mod.ts'
import type { ForwardedHeaders } from '../shared.ts'
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
export const makeEndingPullStream = ({
  req,
  payload,
  headers,
}: {
  req: SyncMessage.PullRequest
  payload: Schema.JsonValue | undefined
  headers: ForwardedHeaders | undefined
}): Stream.Stream<SyncMessage.PullResponse, UnknownError | BackendIdMismatchError, DoCtx> =>
  Effect.gen(function* () {
    const { doOptions, backendId, storeId, storage } = yield* DoCtx
    const backendIdString = backendId

    if (doOptions?.onPull !== undefined) {
      yield* Effect.tryAll(() =>
        doOptions.onPull!(req, {
          storeId,
          ...(payload !== undefined ? { payload } : {}),
          ...(headers !== undefined ? { headers } : {}),
        }),
      ).pipe(UnknownError.mapToUnknownError)
    }

    if (req.cursor._tag === 'Some' && req.cursor.value.backendId !== backendId) {
      return yield* new BackendIdMismatchError({
        expected: backendIdString,
        received: String(req.cursor.value.backendId),
      })
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
              SyncMessage.PullResponse.make({
                batch,
                pageInfo: SyncBackend.pageInfoNoMore,
                backendId: backendIdString,
              }),
            ) as unknown as string,
        }),
      ),
      Stream.mapAccum(total, (remaining, chunk) => {
        const asArray = Chunk.toReadonlyArray(chunk)
        const nextRemaining = Math.max(0, remaining - asArray.length)

        return [
          nextRemaining,
          SyncMessage.PullResponse.make({
            batch: asArray as SyncMessage.PullResponse['batch'],
            pageInfo: nextRemaining > 0 ? SyncBackend.pageInfoMoreKnown(nextRemaining) : SyncBackend.pageInfoNoMore,
            backendId: backendIdString,
          }),
        ] as const
      }),
      Stream.tap(
        Effect.fn(function* (res) {
          if (doOptions?.onPullRes !== undefined) {
            yield* Effect.tryAll(() => doOptions.onPullRes!(res)).pipe(UnknownError.mapToUnknownError)
          }
        }),
      ),
      Stream.emitIfEmpty(SyncMessage.emptyPullResponse(backendIdString)),
    )
  }).pipe(
    Stream.unwrap,
    Stream.mapError((cause) =>
      cause._tag === 'BackendIdMismatchError' || cause._tag === 'UnknownError' ? cause : new UnknownError({ cause }),
    ),
    Stream.withSpan('cloudflare-provider:pull'),
  )
