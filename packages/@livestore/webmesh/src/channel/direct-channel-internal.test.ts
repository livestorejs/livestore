import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  PubSub,
  Queue,
  Result,
  Schema,
  Scope,
  Stream,
  TestClock,
  WebChannel,
} from '@livestore/utils/effect'

import type { MessageQueueItem } from '../common.ts'
import * as MeshSchema from '../mesh-schema.ts'
import { makeDirectChannelInternal } from './direct-channel-internal.ts'

const payloadSchema = Schema.Struct({ message: Schema.String })
const wireSchema = Schema.Union([payloadSchema, MeshSchema.DirectChannelPing, MeshSchema.DirectChannelPong])

Vitest.describe('direct channel handshake', () => {
  Vitest.effect('waits for a delayed peer without resending acknowledged protocol messages', () =>
    Effect.gen(function* () {
      const mc = new MessageChannel()
      const incomingPacketsQueue = yield* Queue.unbounded<MessageQueueItem>()
      const receivedPackets = yield* Queue.unbounded<unknown>()
      const onMessage = (event: MessageEvent) => {
        Queue.offerUnsafe(receivedPackets, event.data)
      }
      mc.port2.addEventListener('message', onMessage)
      yield* Effect.addFinalizer(() => Effect.sync(() => mc.port2.removeEventListener('message', onMessage)))
      // Construct the real peer eagerly, but do not drain/ack its buffered messages yet.
      const peer = yield* WebChannel.messagePortChannelWithAck({ port: mc.port2, schema: wireSchema })
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
      const channelFiber = yield* makeDirectChannelInternal({
        nodeName: 'A',
        target: 'B',
        channelName: 'test',
        channelVersion: 1,
        sourceId: 'A',
        scope,
        onHigherVersion: (version) => expect.fail(`Unexpected peer version ${version}`),
        schema: { send: payloadSchema, listen: payloadSchema },
        incomingPacketsQueue,
        newEdgeAvailablePubSub: yield* PubSub.unbounded<string>(),
        checkTransferableEdges: () => undefined,
        sendPacket: (packet) =>
          Effect.gen(function* () {
            if (packet._tag !== 'DirectChannelRequest') return
            const fields = {
              source: 'B',
              target: 'A',
              channelName: 'test',
              channelVersion: 1,
              hops: [],
              remainingHops: [],
              reqId: packet.id,
            }
            yield* Queue.offer(incomingPacketsQueue, {
              packet: MeshSchema.DirectChannelRequest.make({ ...fields, sourceId: 'B' }),
              respondToSender: () => Effect.void,
            })
            yield* Queue.offer(incomingPacketsQueue, {
              packet: MeshSchema.DirectChannelResponseSuccess.make({ ...fields, port: mc.port1 }),
              respondToSender: () => Effect.void,
            })
          }),
      }).pipe(Effect.forkScoped)

      expect(yield* Queue.take(receivedPackets)).toMatchObject({
        _tag: 'ChannelRequest',
        payload: { _tag: 'DirectChannelPing' },
      })
      // Longer than all three former 10ms probe attempts, with no wall-clock timing race.
      yield* TestClock.adjust(100)
      const openPeer = yield* WebChannel.toOpenChannel(peer)
      const pongFiber = yield* openPeer.send(MeshSchema.DirectChannelPong.make({})).pipe(Effect.forkScoped)
      const channel = yield* Fiber.join(channelFiber)
      yield* Fiber.join(pongFiber)
      // A slow ack must not create duplicate protocol requests.
      const remaining = yield* Queue.takeAll(receivedPackets)
      expect(remaining.filter(Schema.is(Schema.TaggedStruct('ChannelRequest', {})))).toEqual([])

      const messages = yield* channel.listen.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* openPeer.send({ message: 'ready' })
      expect(yield* Fiber.join(messages)).toEqual([Result.succeed({ message: 'ready' })])
    }),
  )

  Vitest.effect('keeps application delivery and control processing alive after a negative established probe', () =>
    Effect.gen(function* () {
      const incomingPacketsQueue = yield* Queue.unbounded<MessageQueueItem>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
      const peerDeferred = yield* Deferred.make<WebChannel.WebChannel<typeof wireSchema.Type, typeof wireSchema.Type>>()
      const channelFiber = yield* makeDirectChannelInternal({
        nodeName: 'B',
        target: 'A',
        channelName: 'test',
        channelVersion: 1,
        sourceId: 'B',
        scope,
        onHigherVersion: (version) => expect.fail(`Unexpected peer version ${version}`),
        schema: { send: payloadSchema, listen: payloadSchema },
        incomingPacketsQueue,
        newEdgeAvailablePubSub: yield* PubSub.unbounded<string>(),
        checkTransferableEdges: () => undefined,
        sendPacket: (packet) =>
          Effect.gen(function* () {
            if (packet._tag !== 'DirectChannelRequest') return
            yield* Queue.offer(incomingPacketsQueue, {
              packet: MeshSchema.DirectChannelRequest.make({
                source: 'A',
                target: 'B',
                sourceId: 'A',
                channelName: 'test',
                channelVersion: 1,
                hops: [],
                remainingHops: [],
                reqId: packet.id,
              }),
              respondToSender: (response) =>
                Effect.gen(function* () {
                  if (response._tag !== 'DirectChannelResponseSuccess') return
                  const winnerPeer = yield* WebChannel.messagePortChannelWithAck({
                    port: response.port,
                    schema: wireSchema,
                  }).pipe(Effect.andThen(WebChannel.toOpenChannel))
                  yield* Deferred.succeed(peerDeferred, winnerPeer)
                }).pipe(Scope.provide(scope)),
            })
          }),
      }).pipe(Scope.provide(scope), Effect.forkScoped)
      const winnerPeer = yield* Deferred.await(peerDeferred)
      yield* winnerPeer.send(MeshSchema.DirectChannelPing.make({}))
      const channel = yield* Fiber.join(channelFiber)
      yield* winnerPeer.send(MeshSchema.DirectChannelPing.make({}))
      yield* winnerPeer.send(MeshSchema.DirectChannelPong.make({}))
      yield* winnerPeer.send({ message: 'payload only' })
      const messages = yield* channel.listen.pipe(Stream.take(1), Stream.runCollect)
      expect(messages).toEqual([Result.succeed({ message: 'payload only' })])
      yield* Queue.offer(incomingPacketsQueue, {
        packet: MeshSchema.DirectChannelResponseNoTransferables.make({
          source: 'A',
          target: 'B',
          channelName: 'test',
          hops: [],
          remainingHops: [],
          reqId: 'topology-probe',
        }),
        respondToSender: () => Effect.void,
      })
      yield* winnerPeer.send({ message: 'still connected' })
      expect(yield* channel.listen.pipe(Stream.take(1), Stream.runCollect)).toEqual([
        Result.succeed({ message: 'still connected' }),
      ])
      // A subsequent replacement must still reach the control processor. If the
      // negative probe ended that loop, this old generation never closes.
      yield* Queue.offer(incomingPacketsQueue, {
        packet: MeshSchema.DirectChannelRequest.make({
          source: 'A',
          target: 'B',
          sourceId: 'replacement-A',
          channelName: 'test',
          channelVersion: 1,
          hops: [],
          reqId: undefined,
        }),
        respondToSender: () => Effect.void,
      })
      yield* Deferred.await(channel.closedDeferred)
    }),
  )
  for (const delayedResponse of ['negative', 'success'] as const) {
    Vitest.effect(`ignores a delayed ${delayedResponse} response from an older generation`, () =>
      Effect.gen(function* () {
        const incomingPacketsQueue = yield* Queue.unbounded<MessageQueueItem>()
        const makeGeneration = (
          channelVersion: number,
          scope: Scope.Closeable,
          stalePacket?: typeof MeshSchema.DirectChannelPacket.Type,
        ) =>
          Effect.gen(function* () {
            const peerDeferred =
              yield* Deferred.make<WebChannel.WebChannel<typeof wireSchema.Type, typeof wireSchema.Type>>()
            const requestId = yield* Deferred.make<string>()
            let requested = false
            const channelFiber = yield* makeDirectChannelInternal({
              nodeName: 'B',
              target: 'A',
              channelName: 'test',
              channelVersion,
              sourceId: `B-${channelVersion}`,
              scope,
              onHigherVersion: (version) => expect.fail(`Obsolete response changed version to ${version}`),
              schema: { send: payloadSchema, listen: payloadSchema },
              incomingPacketsQueue,
              newEdgeAvailablePubSub: yield* PubSub.unbounded<string>(),
              checkTransferableEdges: () => undefined,
              sendPacket: (packet) =>
                Effect.gen(function* () {
                  if (packet._tag !== 'DirectChannelRequest' || requested === true) return
                  requested = true
                  yield* Deferred.succeed(requestId, packet.id)
                  if (stalePacket !== undefined) {
                    yield* Queue.offer(incomingPacketsQueue, {
                      packet: stalePacket,
                      respondToSender: () => Effect.void,
                    })
                  }
                  yield* Queue.offer(incomingPacketsQueue, {
                    packet: MeshSchema.DirectChannelRequest.make({
                      source: 'A',
                      target: 'B',
                      channelName: 'test',
                      sourceId: `A-${channelVersion}`,
                      channelVersion,
                      hops: [],
                      reqId: packet.id,
                    }),
                    respondToSender: (response) =>
                      Effect.gen(function* () {
                        if (response._tag !== 'DirectChannelResponseSuccess') return
                        const peer = yield* WebChannel.messagePortChannelWithAck({
                          port: response.port,
                          schema: wireSchema,
                        }).pipe(Effect.andThen(WebChannel.toOpenChannel))
                        yield* Deferred.succeed(peerDeferred, peer)
                      }).pipe(Scope.provide(scope)),
                  })
                }),
            }).pipe(Scope.provide(scope), Effect.forkScoped)
            const peer = yield* Deferred.await(peerDeferred)
            yield* peer.send(MeshSchema.DirectChannelPing.make({}))
            return { channel: yield* Fiber.join(channelFiber), peer, requestId: yield* Deferred.await(requestId) }
          })
        const oldScope = yield* Scope.make()
        yield* Effect.addFinalizer((exit) => Scope.close(oldScope, exit))
        const old = yield* makeGeneration(10000, oldScope)
        yield* Scope.close(oldScope, Exit.void)
        const fields = {
          source: 'A',
          target: 'B',
          channelName: 'test',
          hops: [],
          remainingHops: [],
          reqId: old.requestId,
        }
        const ports = new MessageChannel()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            ports.port1.close()
            ports.port2.close()
          }),
        )
        const stalePacket =
          delayedResponse === 'negative'
            ? MeshSchema.DirectChannelResponseNoTransferables.make(fields)
            : MeshSchema.DirectChannelResponseSuccess.make({ ...fields, channelVersion: 10000, port: ports.port1 })
        // A fresh wrapper resets its local generation. Its shared queue can still
        // contain a delayed old response with a larger version or no version at all.
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
        const replacement = yield* makeGeneration(1, scope, stalePacket)
        yield* replacement.peer.send({ message: 'fresh generation' })
        expect(yield* replacement.channel.listen.pipe(Stream.take(1), Stream.runCollect)).toEqual([
          Result.succeed({ message: 'fresh generation' }),
        ])
      }),
    )
  }
})
