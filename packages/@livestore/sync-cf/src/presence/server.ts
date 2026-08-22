import { Effect, Schema, Stream } from '@livestore/utils/effect'

import { PresenceClientMessage, PresenceSnapshot, PresenceServerMessage } from './schema.ts'
import { makePresenceRoom, type PresenceRoom } from './room.ts'

/**
 * A transport-agnostic presence server bound to one `storeId`.
 *
 * The server owns the in-memory `PresenceRoom` and exposes the protocol
 * handling: a `handleClientMessage` for inbound client messages and a
 * `snapshots` stream for outbound broadcasts. Both the Node WebSocket server
 * and the Cloudflare Durable Object feed messages in and drain snapshots out.
 */
export interface PresenceServer {
  readonly storeId: string
  readonly room: PresenceRoom
  /** Decodes and applies a client message, returning the server response. */
  handleClientMessage: (encoded: string | Uint8Array) => Effect.Effect<PresenceServerMessage>
  /** Stream of full-room snapshots to broadcast to every connected client. */
  readonly snapshots: Stream.Stream<PresenceSnapshot, never>
}

const encodeServerMessage = Schema.encodeSync(PresenceServerMessage)
const decodeClientMessage = Schema.decodeUnknownSync(PresenceClientMessage)

/**
 * Creates the presence server for a `storeId`.
 */
export const makePresenceServer = (
  storeId: string,
): Effect.Effect<PresenceServer, never, never> =>
  Effect.gen(function* () {
    const room = yield* makePresenceRoom(storeId)

    const snapshotOf = Effect.sync(() => room.snapshot.value)

    const handleClientMessage = (encoded: string | Uint8Array) =>
      Effect.gen(function* () {
        const message = decodeClientMessage(encoded)
        switch (message._tag) {
          case 'PresenceClient.join':
            yield* room.join(message.clientId, message.name)
            return { _tag: 'PresenceServer.snapshot', snapshot: yield* snapshotOf } as PresenceServerMessage
          case 'PresenceClient.state':
            yield* room.update(message.state)
            return { _tag: 'PresenceServer.snapshot', snapshot: yield* snapshotOf } as PresenceServerMessage
          case 'PresenceClient.leave':
            yield* room.leave(message.clientId)
            return { _tag: 'PresenceServer.snapshot', snapshot: yield* snapshotOf } as PresenceServerMessage
        }
      }).pipe(
        Effect.catch((cause) =>
          Effect.succeed({ _tag: 'PresenceServer.error', message: String(cause) }) as Effect.Effect<PresenceServerMessage>,
        ),
      )

    return {
      storeId,
      room,
      handleClientMessage,
      snapshots: room.snapshots,
    }
  })

export { encodeServerMessage, encodeServerMessage as encodePresenceServerMessage }
export type { PresenceRoom }