import { UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../common/mod.ts'
import { makePull } from '../pull.ts'
import { makePush } from '../push.ts'
import {
  type Env,
  encodeOutgoingMessage,
  type MakeDurableObjectClassOptions,
  type RpcSubscription,
  type StoreId,
  WebSocketAttachmentSchema,
} from '../shared.ts'
import { makeStorage } from '../sync-storage.ts'

export const handleWebSocketMessage = ({
  message,
  rpcSubscriptions,
  pushSemaphore,
  currentHeadRef,
  options,
  ctx,
  ws,
  env,
}: {
  message: SyncMessage.ClientToBackendMessage
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  pushSemaphore: Effect.Semaphore
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
  options: MakeDurableObjectClassOptions | undefined
  ctx: CfTypes.DurableObjectState
  ws: CfTypes.WebSocket
  env: Env
}) =>
  Effect.gen(function* () {
    const { storeId, payload } = yield* Schema.decode(WebSocketAttachmentSchema)(ws.deserializeAttachment())

    const requestId = message.requestId

    const respond = (message: SyncMessage.BackendToClientMessage) =>
      Effect.try({
        try: () => ws.send(encodeOutgoingMessage(message)),
        catch: (cause) => new UnexpectedError({ cause, note: 'Failed response', payload: { message } }),
      })

    const storage = makeStorage(ctx, env, storeId)

    const pull = makePull({ storage })
    const push = makePush({
      storage,
      requestId,
      options,
      rpcSubscriptions,
      pushSemaphore,
      currentHeadRef,
      storeId,
      payload,
      ctx,
      respond,
    })

    switch (message._tag) {
      // TODO allow pulling concurrently to not block incoming push requests
      case 'SyncMessage.PullRequest': {
        if (options?.onPull) {
          yield* Effect.tryAll(() => options.onPull!(message, { storeId, payload })).pipe(
            UnexpectedError.mapToUnexpectedError,
          )
        }

        yield* pull(message).pipe(
          Stream.tap(
            Effect.fn(function* (message) {
              if (options?.onPullRes) {
                yield* Effect.tryAll(() => options.onPullRes!(message)).pipe(UnexpectedError.mapToUnexpectedError)
              }

              if (ws.readyState !== WebSocket.OPEN) {
                yield* Effect.logWarning('WebSocket not open, skipping send', {
                  readyState: ws.readyState,
                  message,
                })
                return
              }

              yield* respond(message)
            }),
          ),
          Stream.runDrain,
        )

        break
      }
      case 'SyncMessage.PushRequest': {
        yield* push(message)

        break
      }
      case 'SyncMessage.AdminResetRoomRequest': {
        if (message.adminSecret !== env.ADMIN_SECRET) {
          ws.send(
            encodeOutgoingMessage(SyncMessage.SyncError.make({ message: 'Invalid admin secret', requestId, storeId })),
          )
          return
        }

        yield* storage.resetStore
        ws.send(encodeOutgoingMessage(SyncMessage.AdminResetRoomResponse.make({ requestId })))

        break
      }
      case 'SyncMessage.AdminInfoRequest': {
        if (message.adminSecret !== env.ADMIN_SECRET) {
          ws.send(
            encodeOutgoingMessage(SyncMessage.SyncError.make({ message: 'Invalid admin secret', requestId, storeId })),
          )
          return
        }

        ws.send(
          encodeOutgoingMessage(
            SyncMessage.AdminInfoResponse.make({ requestId, info: { durableObjectId: ctx.id.toString() } }),
          ),
        )

        break
      }
      default: {
        yield* Effect.logError('unsupported message', { message: message })
        return shouldNeverHappen(`unsupported message: ${message._tag}`)
      }
    }
  }).pipe(
    Effect.withSpan(`@livestore/sync-cf:durable-object:webSocketMessage:${message._tag}`, {
      attributes: { requestId: message.requestId },
    }),
    Effect.tapErrorCause((cause) =>
      Effect.sync(() =>
        ws.send(
          encodeOutgoingMessage(
            SyncMessage.SyncError.make({ message: cause.toString(), requestId: message.requestId }),
          ),
        ),
      ),
    ),
  )
