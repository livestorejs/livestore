export * from 'effect/unstable/rpc/RpcClient'

import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import { Protocol } from 'effect/unstable/rpc/RpcClient'
import { Socket } from 'effect/unstable/socket'
import { Effect, Layer, Schedule, type Scope } from 'effect'

import * as SubscriptionRef from './SubscriptionRef.ts'

export type SocketPinger = {
  readonly timeout: Effect.Effect<never>
  readonly reset: () => void
  readonly onPong: () => void
  readonly ping: Effect.Effect<void>
}

const noopPinger: SocketPinger = {
  timeout: Effect.never,
  reset: () => {},
  onPong: () => {},
  ping: Effect.void,
}

export const layerProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
  readonly pingSchedule?: Schedule.Schedule<unknown> | undefined
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | Socket.Socket> =>
  Layer.effect(Protocol)(makeProtocolSocketWithIsConnected(options))

export const makeProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
  readonly pingSchedule?: Schedule.Schedule<unknown> | undefined
}): Effect.Effect<Protocol['Service'], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket> =>
  RpcClient.makeProtocolSocket({
    retryTransientErrors: options.retryTransientErrors !== undefined,
    retryPolicy: options.retryTransientErrors as any,
  }).pipe(
    Effect.map((protocol) => ({ ...protocol, pinger: noopPinger }) as Protocol['Service'] & { pinger: SocketPinger }),
  )

export const SocketPinger = Effect.map(Protocol.asEffect(), (protocol) => (protocol as any).pinger as SocketPinger)
