import {
  Effect,
  Layer,
  Ref,
  RpcClient,
  RpcSerialization,
  Scope,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { SyncWsRpc } from '../common/ws-rpc-schema.ts'
import { DEFAULT_PRESENCE_ROOM_ID, type PresenceSnapshot } from './schema.ts'

export interface PresenceClientOptions {
  /** Sync backend URL (same endpoint the LiveStore worker uses). */
  url: string
  storeId: string
  clientId: string
  name?: string
  payload?: unknown
  /**
   * Default room this client joins. Isolation unit: members of other rooms
   * never see this client's state. @default 'default'
   */
  room?: string
  /** Extra rooms to join at connect time (in addition to `room`). */
  rooms?: ReadonlyArray<string>
  /** How often to heartbeat so idle-TTL does not prune this client. */
  heartbeatIntervalMs?: number
  /** Coalescing window in ms for high-frequency streams. @default 40 */
  throttleIntervalMs?: number
}

export type PresenceStatePatch = Record<string, unknown>

/** Local merge used by `setState`. `null` / `undefined` deletes the key. */
export const mergePresencePatch = (prev: PresenceStatePatch, patch: PresenceStatePatch): PresenceStatePatch => {
  const next: PresenceStatePatch = { ...prev }
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || value === null) {
      delete next[field]
    } else {
      next[field] = value
    }
  }
  return next
}

export interface PresenceRoomHandle<TChannels extends Record<string, unknown>> {
  readonly roomId: string
  snapshots: <K extends keyof TChannels & string>(channel: K) => Stream.Stream<PresenceSnapshot>
  snapshotRef: <K extends keyof TChannels & string>(channel: K) => SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  setState: <K extends keyof TChannels & string>(channel: K, patch: PresenceStatePatch) => Effect.Effect<void>
  join: Effect.Effect<void>
  leave: Effect.Effect<void>
}

export interface PresenceClient<TChannels extends Record<string, unknown>> extends PresenceRoomHandle<TChannels> {
  readonly storeId: string
  readonly clientId: string
  /** Handle for another room. Joins lazily on first `setState` / `snapshots`. */
  room: (roomId: string) => PresenceRoomHandle<TChannels>
}

type ChannelState = Record<string, unknown>

/**
 * Ephemeral presence client. Sends the full accumulated channel state (not
 * merge-patches) so clearing a field is reflected on the server.
 */
export const makePresenceClient = <TChannels extends Record<string, unknown>>(
  options: PresenceClientOptions & { channels: TChannels },
): Effect.Effect<PresenceClient<TChannels>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const channelNames = Object.keys(options.channels)
    const defaultRoomId = options.room ?? DEFAULT_PRESENCE_ROOM_ID
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000
    const throttleIntervalMs = options.throttleIntervalMs ?? 40

    const snapshotRefs = yield* Ref.make(
      new Map<string, SubscriptionRef.SubscriptionRef<PresenceSnapshot>>(),
    )
    const stateRef = yield* Ref.make(new Map<string, ChannelState>())
    const throttledRef = yield* Ref.make(new Map<string, number>())
    const joinedRooms = yield* Ref.make(new Set<string>())

    const refKey = (roomId: string, channel: string) => `${roomId}\0${channel}`

    const getSnapshotRef = Effect.fnUntraced(function* (roomId: string, channel: string) {
      const key = refKey(roomId, channel)
      const existing = (yield* Ref.get(snapshotRefs)).get(key)
      if (existing !== undefined) return existing
      const ref = yield* SubscriptionRef.make<PresenceSnapshot>({
        storeId: options.storeId,
        roomId,
        channel,
        members: [],
      })
      yield* Ref.update(snapshotRefs, (map) => new Map(map).set(key, ref))
      return ref
    })

    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(
        Socket.layerWebSocket(
          `${options.url}?storeId=${encodeURIComponent(options.storeId)}&transport=ws${options.payload !== undefined ? `&payload=${encodeURIComponent(JSON.stringify(options.payload))}` : ''}`,
        ),
      ),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    const ctx = yield* Layer.build(ProtocolLive)
    const rpcClient = yield* RpcClient.make(SyncWsRpc).pipe(Effect.provide(ctx))

    const joinRoom = (roomId: string) =>
      Effect.gen(function* () {
        const joined = yield* Ref.get(joinedRooms)
        if (joined.has(roomId)) return
        yield* Effect.forEach(channelNames, (channel) =>
          rpcClient['SyncWsRpc.PresenceJoin']({
            storeId: options.storeId,
            roomId,
            channel,
            clientId: options.clientId,
            name: options.name,
          }).pipe(Effect.ignore),
        )
        yield* Effect.forEach(channelNames, (channel) =>
          rpcClient['SyncWsRpc.PresenceSnapshots']({
            storeId: options.storeId,
            roomId,
            channel,
          }).pipe(
            Stream.mapEffect((snapshot) =>
              Effect.gen(function* () {
                const ref = yield* getSnapshotRef(roomId, channel)
                yield* SubscriptionRef.set(ref, snapshot)
              }),
            ),
            Stream.runDrain,
            Effect.interruptible,
            Effect.ignore,
            Effect.forkDetach,
          ),
        )
        yield* Ref.update(joinedRooms, (set) => new Set(set).add(roomId))
      })

    const leaveRoom = (roomId: string) =>
      Effect.gen(function* () {
        yield* Effect.forEach(channelNames, (channel) =>
          rpcClient['SyncWsRpc.PresenceLeave']({
            storeId: options.storeId,
            roomId,
            channel,
            clientId: options.clientId,
          }).pipe(Effect.ignore),
        )
        yield* Ref.update(joinedRooms, (set) => {
          const next = new Set(set)
          next.delete(roomId)
          return next
        })
      })

    const sendState = (roomId: string, channel: string) =>
      Effect.gen(function* () {
        const state = (yield* Ref.get(stateRef)).get(refKey(roomId, channel))
        if (state === undefined) return
        yield* rpcClient['SyncWsRpc.PresenceUpdate']({
          storeId: options.storeId,
          roomId,
          channel,
          clientId: options.clientId,
          patch: state,
        }).pipe(Effect.ignore)
      })

    const flushChannel = (roomId: string, channel: string) =>
      Effect.gen(function* () {
        const key = refKey(roomId, channel)
        const last = (yield* Ref.get(throttledRef)).get(key) ?? 0
        if (Date.now() - last < throttleIntervalMs) return
        yield* Ref.update(throttledRef, (map) => new Map(map).set(key, Date.now()))
        yield* sendState(roomId, channel)
      })

    const setStateIn = (roomId: string, channel: string, patch: PresenceStatePatch) =>
      Effect.gen(function* () {
        yield* joinRoom(roomId)
        const key = refKey(roomId, channel)
        const prevState = (yield* Ref.get(stateRef)).get(key) ?? {}
        const next = mergePresencePatch(prevState, patch)
        yield* Ref.update(stateRef, (map) => new Map(map).set(key, next))
        yield* flushChannel(roomId, channel)
      }).pipe(Effect.ignore)

    const makeHandle = (roomId: string): PresenceRoomHandle<TChannels> => ({
      roomId,
      snapshotRef: ((channel: string) => Effect.runSync(getSnapshotRef(roomId, channel))) as PresenceRoomHandle<TChannels>['snapshotRef'],
      snapshots: ((channel: string) =>
        Effect.map(getSnapshotRef(roomId, channel), (ref) => SubscriptionRef.changes(ref)).pipe(
          Stream.unwrap,
        )) as PresenceRoomHandle<TChannels>['snapshots'],
      setState: (channel, patch) => setStateIn(roomId, channel, patch),
      join: joinRoom(roomId),
      leave: leaveRoom(roomId),
    })

    const initialRooms = [defaultRoomId, ...(options.rooms ?? [])]
    yield* Effect.forEach(initialRooms, joinRoom)

    yield* Effect.forkDetach(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(heartbeatIntervalMs)
          const joined = yield* Ref.get(joinedRooms)
          for (const roomId of joined) {
            for (const channel of channelNames) {
              yield* sendState(roomId, channel)
            }
          }
        }
      }).pipe(Effect.interruptible, Effect.ignore),
    )

    const defaultHandle = makeHandle(defaultRoomId)

    return {
      storeId: options.storeId,
      clientId: options.clientId,
      ...defaultHandle,
      leave: Effect.gen(function* () {
        const joined = yield* Ref.get(joinedRooms)
        yield* Effect.forEach([...joined], leaveRoom)
      }),
      room: (roomId) => makeHandle(roomId),
    }
  })
