import { BackendIdMismatchError, InvalidPullError, SyncBackend, UnknownError } from '@livestore/common'
import { splitChunkBySize } from '@livestore/common/sync'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'
import {
  type CallbackContext,
  MAX_PULL_EVENTS_PER_MESSAGE,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  type ServerCallbacks,
  SyncMessage,
} from '../../common/mod.ts'
import type { SyncStorage } from '../storage/mod.ts'

const encodePullResponse = Schema.encodeSync(SyncMessage.PullResponse)

export type PullHandlerDeps = {
  readonly storage: SyncStorage
  readonly callbacks?: ServerCallbacks | undefined
}

/**
 * Creates a pull stream that emits events from storage.
 * The stream ends after all existing events have been emitted.
 * For live updates, see the SSE or WebSocket handlers which keep the connection open.
 */
export const makePullStream = ({
  req,
  storeId,
  context,
  deps,
}: {
  req: SyncMessage.PullRequest
  storeId: string
  context: CallbackContext
  deps: PullHandlerDeps
}): Stream.Stream<SyncMessage.PullResponse, InvalidPullError> =>
  Effect.gen(function* () {
    const { storage, callbacks } = deps

    // Call onPull callback if provided
    if (callbacks?.onPull) {
      yield* Effect.try(() => callbacks.onPull!(req, context)).pipe(UnknownError.mapToUnknownError)
    }

    // Get backend ID
    const backendId = yield* storage.getBackendId(storeId)

    // Validate backend ID if cursor is provided
    if (req.cursor._tag === 'Some' && req.cursor.value.backendId !== backendId) {
      return yield* new BackendIdMismatchError({ expected: backendId, received: req.cursor.value.backendId })
    }

    // Get cursor sequence number
    const cursorSeqNum = Option.map(req.cursor, (c) => c.eventSequenceNumber)

    // Get events from storage
    const { stream: storedEvents, total } = yield* storage.getEvents(storeId, cursorSeqNum)

    return storedEvents.pipe(
      // Split into chunks that fit within transport limits
      Stream.mapChunksEffect(
        splitChunkBySize({
          maxItems: MAX_PULL_EVENTS_PER_MESSAGE,
          maxBytes: MAX_TRANSPORT_PAYLOAD_BYTES,
          encode: (batch) =>
            encodePullResponse(
              SyncMessage.PullResponse.make({ batch, pageInfo: SyncBackend.pageInfoNoMore, backendId }),
            ),
        }),
      ),
      // Track remaining count and build response
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
      // Call onPullRes callback for each response chunk
      Stream.tap(
        Effect.fn(function* (res) {
          if (callbacks?.onPullRes) {
            yield* Effect.try(() => callbacks.onPullRes!(res)).pipe(UnknownError.mapToUnknownError)
          }
        }),
      ),
      // Emit empty response if no events
      Stream.emitIfEmpty(SyncMessage.emptyPullResponse(backendId)),
    )
  }).pipe(
    Stream.unwrap,
    Stream.mapError((cause) => InvalidPullError.make({ cause })),
    Stream.withSpan('sync-http:pull', { attributes: { storeId } }),
  )
