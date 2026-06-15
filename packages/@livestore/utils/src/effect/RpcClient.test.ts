import * as Vitest from '@effect/vitest'
import { Effect, Exit, Fiber } from 'effect'
import { RpcSerialization } from 'effect/unstable/rpc'
import { Socket } from 'effect/unstable/socket'

import { makeProtocolSocketWithIsConnected, type SocketPinger } from './RpcClient.ts'
import * as SubscriptionRef from './SubscriptionRef.ts'

Vitest.describe('RpcClient socket protocol', () => {
  Vitest.live('manual pings write a Ping frame and wait for Pong', () =>
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization
      const outboundParser = serialization.makeUnsafe()
      const inboundParser = serialization.makeUnsafe()

      const outbound: Array<string | Uint8Array | Socket.CloseEvent> = []
      let emitInbound: ((message: string | Uint8Array) => Effect.Effect<void>) | undefined

      const socket = Socket.make({
        runRaw: (handler, options) =>
          Effect.gen(function* () {
            emitInbound = (message) => Effect.asVoid((handler(message) ?? Effect.void) as Effect.Effect<unknown>)
            yield* options?.onOpen ?? Effect.void
            yield* Effect.never
          }) as Effect.Effect<void>,
        writer: Effect.succeed((chunk) => Effect.sync(() => outbound.push(chunk))),
      })

      const isConnected = yield* SubscriptionRef.make(false)

      const protocol = yield* makeProtocolSocketWithIsConnected({ url: 'ws://test', isConnected }).pipe(
        Effect.provideService(Socket.Socket, socket),
      )
      const pinger = (protocol as typeof protocol & { readonly pinger: SocketPinger }).pinger

      const prematurePingExit = yield* pinger.ping.pipe(Effect.timeout('50 millis'), Effect.exit)

      Vitest.expect(Exit.isFailure(prematurePingExit)).toBe(true)
      Vitest.expect(outboundParser.decode(outbound[0] as string | Uint8Array)).toEqual([{ _tag: 'Ping' }])

      const pingFiber = yield* pinger.ping.pipe(Effect.timeout('500 millis'), Effect.forkScoped)

      yield* Effect.yieldNow

      Vitest.expect(outboundParser.decode(outbound[1] as string | Uint8Array)).toEqual([{ _tag: 'Ping' }])

      yield* emitInbound!(inboundParser.encode({ _tag: 'Pong' })!)

      yield* Fiber.join(pingFiber)
    }).pipe(Effect.scoped, Effect.provide(RpcSerialization.layerJson)),
  )
})
