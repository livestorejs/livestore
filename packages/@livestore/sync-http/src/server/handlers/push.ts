import { BackendIdMismatchError, InvalidPushError, ServerAheadError, UnknownError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import { Effect, Option } from '@livestore/utils/effect'
import { type CallbackContext, type ServerCallbacks, SyncMessage } from '../../common/mod.ts'
import type { SyncStorage } from '../storage/mod.ts'

export type PushHandlerDeps = {
  readonly storage: SyncStorage
  readonly callbacks?: ServerCallbacks | undefined
  /** Called when events are pushed, for broadcasting to live connections */
  readonly onBroadcast?: ((storeId: string, events: SyncMessage.PullResponse) => Effect.Effect<void, never>) | undefined
}

/**
 * Handles a push request by appending events to storage.
 * Validates sequence continuity and backend ID.
 */
export const handlePush = ({
  req,
  storeId,
  context,
  deps,
}: {
  req: SyncMessage.PushRequest
  storeId: string
  context: CallbackContext
  deps: PushHandlerDeps
}): Effect.Effect<SyncMessage.PushAck, InvalidPushError> =>
  Effect.gen(function* () {
    const { storage, callbacks, onBroadcast } = deps

    // Empty batch is a no-op
    if (req.batch.length === 0) {
      return SyncMessage.PushAck.make({})
    }

    // Call onPush callback if provided
    if (callbacks?.onPush) {
      yield* Effect.try(() => callbacks.onPush!(req, context)).pipe(UnknownError.mapToUnknownError)
    }

    // Get backend ID
    const backendId = yield* storage.getBackendId(storeId)

    // Validate backend ID if provided
    if (req.backendId._tag === 'Some' && req.backendId.value !== backendId) {
      return yield* new BackendIdMismatchError({ expected: backendId, received: req.backendId.value })
    }

    // Get current head to validate sequence
    const currentHeadOpt = yield* storage.getHead(storeId)
    const currentHead = Option.getOrElse(currentHeadOpt, () => 0)

    // Validate sequence continuity
    const firstEventParent = req.batch[0]!.parentSeqNum
    if (firstEventParent !== currentHead) {
      return yield* new ServerAheadError({
        minimumExpectedNum: currentHead as EventSequenceNumber.Global.Type,
        providedNum: firstEventParent as EventSequenceNumber.Global.Type,
      })
    }

    const createdAt = new Date().toISOString()

    // Append events to storage
    yield* storage.appendEvents(storeId, req.batch, createdAt)

    // Broadcast to live connections if handler is provided
    if (onBroadcast) {
      const response = SyncMessage.PullResponse.make({
        batch: req.batch.map((eventEncoded) => ({
          eventEncoded,
          metadata: Option.some(SyncMessage.SyncMetadata.make({ createdAt })),
        })),
        pageInfo: { _tag: 'NoMore' },
        backendId,
      })

      yield* onBroadcast(storeId, response).pipe(
        Effect.tapCauseLogPretty,
        Effect.fork, // Run in background
      )
    }

    const ack = SyncMessage.PushAck.make({})

    // Call onPushRes callback if provided
    if (callbacks?.onPushRes) {
      yield* Effect.try(() => callbacks.onPushRes!(ack)).pipe(UnknownError.mapToUnknownError)
    }

    return ack
  }).pipe(
    Effect.mapError((cause) => InvalidPushError.make({ cause })),
    Effect.withSpan('sync-http:push', { attributes: { storeId, batchSize: req.batch.length } }),
  )
