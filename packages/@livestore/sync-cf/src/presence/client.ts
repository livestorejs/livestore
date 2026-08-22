import {
  Duration,
  Effect,
  Ref,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { PresenceClientMessage, PresenceServerMessage, PresenceSnapshot, PresenceState } from './schema.ts'

export interface PresenceClientOptions {
  /** Presence server URL, e.g. `ws://localhost:8787` or `wss://example.com/presence`. */
  url: string
  storeId: string
  clientId: string
  /** Optional display name shared with peers. */
  name?: string
  /** Reconnect schedule after a dropped connection. Defaults to exponential backoff. */
  reconnect?: Schedule.Schedule<unknown> | false
  /** How often to re-emit the local state as a heartbeat. Defaults to 10s. */
  heartbeatInterval?: Duration.Input
  /** Coalescing window in ms for high-frequency updates (e.g. cursor moves). Defaults to 50. */
  throttleIntervalMs?: number
}

export interface PresenceClient {
  readonly storeId: string
  readonly clientId: string
  readonly snapshot: SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  /** Live stream of room snapshots. */
  readonly snapshots: Stream.Stream<PresenceSnapshot, never>
  /** Send a state update (cursor, typing, textCursor, …). Coalesces rapid calls. */
  setState: (patch: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>) => Effect.Effect<void, never, Scope.Scope>
  /** Convenience for Figma-style cursor movement at high frequency. */
  setCursor: (x: number, y: number) => Effect.Effect<void, never, Scope.Scope>
  /** Convenience for the typing indicator. */
  setTyping: (typing: boolean) => Effect.Effect<void, never, Scope.Scope>
  /** Convenience for a Google-Docs-style text cursor. */
  setTextCursor: (offset: number) => Effect.Effect<void, never, Scope.Scope>
  /** Mark the client offline and disconnect. */
  leave: Effect.Effect<void, never, Scope.Scope>
}

/**
 * Creates an ephemeral presence client for a single room (`storeId`).
 *
 * The client never writes to LiveStore's eventlog, SQLite, or sync backend —
 * presence is broadcast-only. It joins the room, emits local state updates
 * (coalesced per throttle window), and exposes the live room snapshot.
 */
export const makePresenceClient = (
  options: PresenceClientOptions,
): Effect.Effect<PresenceClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const encodeClientMessage = Schema.encodeSync(PresenceClientMessage)
    const decodeServerMessage = Schema.decodeUnknownSync(PresenceServerMessage)

    const snapshotRef = yield* SubscriptionRef.make<PresenceSnapshot>({
      storeId: options.storeId,
      clients: [],
    })

    const socketRef = yield* Ref.make<globalThis.WebSocket | undefined>(undefined)

    const send = (socket: globalThis.WebSocket, message: unknown) =>
      Effect.try({
        try: () => socket.send(JSON.stringify(message)),
        catch: (cause) => new PresenceSendError({ cause }),
      })

    // Lazy (re)connect: opens the socket on first use, re-joins the room, and
    // replays the latest snapshot on reconnect so stale members are pruned.
    const connect = Effect.gen(function* () {
      const existing = yield* Ref.get(socketRef)
      if (existing !== undefined && existing.readyState === globalThis.WebSocket.OPEN) {
        return existing
      }

      const socket = yield* Effect.acquireRelease(
        openSocket(options.url),
        (ws) => Effect.sync(() => ws.close(1000, 'client-dispose')),
      )
      yield* Ref.set(socketRef, socket)

      yield* Effect.sync(() => {
        socket.addEventListener('message', (event) => {
          const message = decodeServerMessage(event.data)
          if (message._tag === 'PresenceServer.snapshot') {
            Effect.runSync(SubscriptionRef.set(snapshotRef, message.snapshot))
          }
        })
      })

      yield* send(socket, encodeClientMessage({ _tag: 'PresenceClient.join', clientId: options.clientId, name: options.name }))

      return socket
    }).pipe(
      Effect.retry(
        options.reconnect === undefined || options.reconnect === false
          ? Schedule.exponential('500 millis').pipe(Schedule.jittered)
          : options.reconnect,
      ),
    )

    // Coalescing throttle: rapid `setState` calls collapse into a single send
    // per throttle window.
    const throttledRef = yield* Ref.make<{
      last: number
      pending: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>
    }>({ last: 0, pending: {} })

    const flushThrottled = Effect.gen(function* () {
      const socket = yield* connect
      const { pending } = yield* Ref.get(throttledRef)
      if (Object.keys(pending).length === 0) return
      const state: PresenceState = {
        clientId: options.clientId,
        name: options.name,
        online: true,
        typing: pending.typing,
        cursor: pending.cursor,
        textCursor: pending.textCursor,
        updatedAt: Date.now(),
      }
      yield* Ref.set(throttledRef, { last: Date.now(), pending: {} })
      yield* send(socket, encodeClientMessage({ _tag: 'PresenceClient.state', state }))
    })

    yield* Effect.forkScoped(
      flushThrottled.pipe(Effect.repeat(Schedule.fixed(options.heartbeatInterval ?? '10 seconds'))),
    )

    const setState = (patch: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(throttledRef)
        yield* Ref.set(throttledRef, {
          last: current.last,
          pending: { ...current.pending, ...patch },
        })
        const elapsed = Date.now() - current.last
        if (elapsed >= (options.throttleIntervalMs ?? 50)) {
          yield* flushThrottled.pipe(Effect.catch(() => Effect.void))
        }
      })

    return {
      storeId: options.storeId,
      clientId: options.clientId,
      snapshot: snapshotRef,
      snapshots: SubscriptionRef.changes(snapshotRef),
      setState,
      setCursor: (x, y) => setState({ cursor: { x, y } }),
      setTyping: (typing) => setState({ typing }),
      setTextCursor: (offset) => setState({ textCursor: offset }),
      leave: Effect.gen(function* () {
        const socket = yield* Ref.get(socketRef)
        if (socket !== undefined) {
          yield* send(socket, encodeClientMessage({ _tag: 'PresenceClient.leave', clientId: options.clientId })).pipe(
            Effect.catch(() => Effect.void),
          )
        }
      }),
    }
  })

export class PresenceSendError extends Schema.TaggedError<PresenceSendError>('~@livestore/presence/PresenceSendError')(
  'PresenceSendError',
  { cause: Schema.Defect() },
) {}

/** Opens a raw WebSocket without pulling in the HttpClient dependency. */
const openSocket = (url: string) =>
  Effect.callback<globalThis.WebSocket, PresenceSendError>((cb, signal) => {
    try {
      const socket = new globalThis.WebSocket(url)
      signal.addEventListener('abort', () => socket.close(1000, 'abort'))
      socket.addEventListener('open', () => cb(Effect.succeed(socket)), { once: true })
      socket.addEventListener('error', (e) => cb(Effect.fail(new PresenceSendError({ cause: e }))), { once: true })
    } catch (cause) {
      cb(Effect.fail(new PresenceSendError({ cause })))
    }
  })