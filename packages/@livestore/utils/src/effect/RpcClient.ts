export * from 'effect/unstable/rpc/RpcClient'

import type { Schedule } from 'effect'
import { Effect, Layer, type Scope } from 'effect'
import type { RpcSerialization } from 'effect/unstable/rpc'
import { RpcClient } from 'effect/unstable/rpc'
import { Protocol } from 'effect/unstable/rpc/RpcClient'
import type { Socket } from 'effect/unstable/socket'

import * as SubscriptionRef from './SubscriptionRef.ts'

export interface SocketPinger {
  readonly timeout: Effect.Effect<never>
  readonly reset: () => void
  readonly onPong: () => void
  readonly ping: Effect.Effect<void>
}

export const layerProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown, Socket.SocketError> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | Socket.Socket> =>
  Layer.effect(Protocol, makeProtocolSocketWithIsConnected(options))

export const makeProtocolSocketWithIsConnected = (options: {
  readonly url: string
  readonly retryTransientErrors?: Schedule.Schedule<unknown, Socket.SocketError> | undefined
  readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>
}): Effect.Effect<Protocol['Service'], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket> =>
  RpcClient.makeProtocolSocket({
    retryTransientErrors: options.retryTransientErrors !== undefined,
    retryPolicy: options.retryTransientErrors,
  }).pipe(
    Effect.map((protocol) => ({
      ...protocol,
      pinger: makeSocketPinger(options.isConnected),
    })),
    Effect.provideService(RpcClient.ConnectionHooks, connectionHooks(options.isConnected)),
  )

export const SocketPinger = Effect.map(RpcClient.Protocol, (protocol) => {
  if (hasSocketPinger(protocol) === true) return protocol.pinger

  throw new Error('RpcClient.Protocol does not expose a SocketPinger')
})

const connectionHooks = (isConnected: SubscriptionRef.SubscriptionRef<boolean>) => ({
  onConnect: SubscriptionRef.set(isConnected, true),
  onDisconnect: SubscriptionRef.set(isConnected, false),
})

const makeSocketPinger = (isConnected: SubscriptionRef.SubscriptionRef<boolean>): SocketPinger => ({
  timeout: Effect.never,
  reset: () => {},
  onPong: () => {},
  ping: SubscriptionRef.waitUntil(isConnected, (connected) => connected === true).pipe(Effect.asVoid),
})

const hasSocketPinger = (
  protocol: Protocol['Service'],
): protocol is Protocol['Service'] & { readonly pinger: SocketPinger } => 'pinger' in protocol
