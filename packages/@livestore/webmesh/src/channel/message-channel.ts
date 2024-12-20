import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import type { PubSub, Schema, Scope } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  Either,
  Fiber,
  FiberHandle,
  Queue,
  Schedule,
  Stream,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'

import { type ChannelName, type MeshNodeName, type MessageQueueItem, packetAsOtelAttributes } from '../common.js'
import * as MeshSchema from '../mesh-schema.js'

interface MakeMessageChannelArgs {
  nodeName: MeshNodeName
  queue: Queue.Queue<MessageQueueItem>
  newConnectionAvailablePubSub: PubSub.PubSub<MeshNodeName>
  channelName: ChannelName
  target: MeshNodeName
  sendPacket: (packet: typeof MeshSchema.MessageChannelPacket.Type) => Effect.Effect<void>
  checkTransferableConnections: (
    packet: typeof MeshSchema.MessageChannelPacket.Type,
  ) => typeof MeshSchema.MessageChannelResponseNoTransferables.Type | undefined
  schema: {
    send: Schema.Schema<any, any>
    listen: Schema.Schema<any, any>
  }
}

export const makeMessageChannel = ({
  nodeName,
  queue,
  newConnectionAvailablePubSub,
  target,
  checkTransferableConnections,
  channelName,
  schema,
  sendPacket,
}: MakeMessageChannelArgs) =>
  Effect.gen(function* () {
    const reconnectTriggerQueue = yield* Queue.unbounded<void>()
    const reconnect = Queue.offer(reconnectTriggerQueue, void 0)

    type ChannelState =
      | { _tag: 'Established' }
      | {
          _tag: 'Initial'
          deferred: Deferred.Deferred<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>
        }
      | {
          _tag: 'RequestSent'
          deferred: Deferred.Deferred<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>
        }
      | {
          _tag: 'ResponseSent'
          // Set in the case where this side already received a request, and created a port.
          // Might be used or discarded based on tie-breaking logic below.
          locallyCreatedPort: MessagePort
          deferred: Deferred.Deferred<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>
        }

    const makeInitialState = Effect.gen(function* () {
      const deferred = yield* Deferred.make<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>()
      return { _tag: 'Initial', deferred } as ChannelState
    })

    const channelStateRef = { current: yield* makeInitialState }

    const makeMessageChannelInternal: Effect.Effect<
      WebChannel.WebChannel<any, any, never>,
      never,
      Scope.Scope
    > = Effect.gen(function* () {
      const processMessagePacket = ({ packet, respondToSender }: MessageQueueItem) =>
        Effect.gen(function* () {
          const channelState = channelStateRef.current

          // yield* Effect.log(`${nodeName}:processing packet ${packet._tag}, channel state: ${channelState._tag}`)

          switch (packet._tag) {
            // Since there can be concurrent MessageChannel responses from both sides,
            // we need to decide which side's port we want to use and which side's port we want to ignore.
            // This is only relevant in the case where both sides already sent their responses.
            // In this case we're using the target name as a "tie breaker" to decide which side's port to use.
            // We do this by sorting the target names lexicographically and use the first one as the winner.
            case 'MessageChannelResponseSuccess': {
              if (channelState._tag === 'Initial') {
                return shouldNeverHappen(
                  `Expected to find message channel request from ${target}, but was in ${channelState._tag} state`,
                )
              }

              if (channelState._tag === 'Established') {
                const deferred = yield* Deferred.make<
                  MessagePort,
                  typeof MeshSchema.MessageChannelResponseNoTransferables.Type
                >()

                channelStateRef.current = { _tag: 'RequestSent', deferred }

                yield* reconnect

                return
              }

              const thisSideAlsoResponded = channelState._tag === 'ResponseSent'

              const usePortFromThisSide = thisSideAlsoResponded && nodeName > target
              yield* Effect.annotateCurrentSpan({ usePortFromThisSide })

              const winnerPort = usePortFromThisSide ? channelState.locallyCreatedPort : packet.port
              yield* Deferred.succeed(channelState.deferred, winnerPort)

              return
            }
            case 'MessageChannelResponseNoTransferables': {
              if (channelState._tag === 'Established') return

              yield* Deferred.fail(channelState!.deferred, packet)
              channelStateRef.current = yield* makeInitialState
              return
            }
            case 'MessageChannelRequest': {
              const mc = new MessageChannel()

              const shouldReconnect = channelState._tag === 'Established'

              const deferred =
                channelState._tag === 'Established'
                  ? yield* Deferred.make<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>()
                  : channelState.deferred

              channelStateRef.current = { _tag: 'ResponseSent', locallyCreatedPort: mc.port1, deferred }

              yield* respondToSender(
                MeshSchema.MessageChannelResponseSuccess.make({
                  reqId: packet.id,
                  target,
                  source: nodeName,
                  channelName: packet.channelName,
                  hops: [],
                  remainingHops: packet.hops,
                  port: mc.port2,
                }),
              )

              // If there's an established channel, we use the new request as a signal
              // to drop the old channel and use the new one
              if (shouldReconnect) {
                yield* reconnect
              }

              break
            }
            default: {
              return casesHandled(packet)
            }
          }
        }).pipe(
          Effect.withSpan(`handleMessagePacket:${packet._tag}:${packet.source}→${packet.target}`, {
            attributes: packetAsOtelAttributes(packet),
          }),
        )

      yield* Stream.fromQueue(queue).pipe(
        Stream.tap(processMessagePacket),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const channelFromPort = (port: MessagePort) =>
        Effect.gen(function* () {
          channelStateRef.current = { _tag: 'Established' }

          // NOTE to support re-connects we need to ack each message
          const channel = yield* WebChannel.messagePortChannelWithAck({ port, schema })

          return channel
        })

      const channelState = channelStateRef.current

      if (channelState._tag === 'Initial' || channelState._tag === 'RequestSent') {
        // Important to make a new deferred here as the old one might have been used already
        // TODO model this better
        const deferred =
          channelState._tag === 'RequestSent'
            ? yield* Deferred.make<MessagePort, typeof MeshSchema.MessageChannelResponseNoTransferables.Type>()
            : channelState.deferred

        channelStateRef.current = { _tag: 'RequestSent', deferred }

        const connectionRequest = Effect.gen(function* () {
          const packet = MeshSchema.MessageChannelRequest.make({ source: nodeName, target, channelName, hops: [] })

          const noTransferableResponse = checkTransferableConnections(packet)
          if (noTransferableResponse !== undefined) {
            yield* Effect.spanEvent(`No transferable connections found for ${packet.source}→${packet.target}`)
            yield* Deferred.fail(deferred, noTransferableResponse)
            return
          }

          yield* sendPacket(packet)
        })

        yield* connectionRequest

        const retryOnNewConnectionFiber = yield* Stream.fromPubSub(newConnectionAvailablePubSub).pipe(
          Stream.tap(() => Effect.spanEvent(`RetryOnNewConnection`)),
          Stream.tap(() => connectionRequest),
          Stream.runDrain,
          Effect.forkScoped,
        )

        const portResult = yield* deferred.pipe(Effect.either)
        yield* Fiber.interrupt(retryOnNewConnectionFiber)

        if (portResult._tag === 'Right') {
          return yield* channelFromPort(portResult.right)
        } else {
          // We'll keep retrying with a new connection
          yield* Stream.fromPubSub(newConnectionAvailablePubSub).pipe(Stream.take(1), Stream.runDrain)

          yield* reconnect

          return yield* Effect.interrupt
        }
      } else {
        // In this case we've already received a request from the other side (before we had a chance to send our request),
        // so we already created a MessageChannel,responded with one port
        // and are now using the other port to create the channel.
        if (channelState._tag === 'ResponseSent') {
          return yield* channelFromPort(channelState.locallyCreatedPort)
        } else {
          return shouldNeverHappen(
            `Expected pending message channel to be in ResponseSent state, but was in ${channelState._tag} state`,
          )
        }
      }
    })

    const internalChannelSref = yield* SubscriptionRef.make<WebChannel.WebChannel<any, any> | false>(false)

    const listenQueue = yield* Queue.unbounded<any>()

    let connectCounter = 0

    const connect = Effect.gen(function* () {
      const connectCount = ++connectCounter
      yield* Effect.spanEvent(`Connecting#${connectCount}`)

      yield* SubscriptionRef.set(internalChannelSref, false)

      yield* Effect.addFinalizer(() => Effect.spanEvent(`Disconnected#${connectCount}`))

      const internalChannel = yield* makeMessageChannelInternal

      yield* SubscriptionRef.set(internalChannelSref, internalChannel)

      yield* Effect.spanEvent(`Connected#${connectCount}`)

      yield* internalChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((msg) => Queue.offer(listenQueue, msg)),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      yield* Effect.never
    }).pipe(Effect.scoped)

    const fiberHandle = yield* FiberHandle.make<void, never>()

    const runConnect = Effect.gen(function* () {
      // Cleanly shutdown the previous connection first
      // Otherwise the old and new connection will "overlap"
      yield* FiberHandle.clear(fiberHandle)
      yield* FiberHandle.run(fiberHandle, connect)
    })

    yield* runConnect

    // Then listen for reconnects
    yield* Stream.fromQueue(reconnectTriggerQueue).pipe(
      Stream.tap(() => runConnect),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // Wait for the initial connection to be established or for an error to occur
    yield* Effect.raceFirst(
      SubscriptionRef.waitUntil(internalChannelSref, (channel) => channel !== false),
      FiberHandle.join(fiberHandle),
    )

    const parentSpan = yield* Effect.currentSpan.pipe(Effect.orDie)

    const send = (message: any) =>
      Effect.gen(function* () {
        const sendFiberHandle = yield* FiberHandle.make<void, never>()

        const sentDeferred = yield* Deferred.make<void>()

        const trySend = Effect.gen(function* () {
          const channel = (yield* SubscriptionRef.waitUntil(
            internalChannelSref,
            (channel) => channel !== false,
          )) as WebChannel.WebChannel<any, any>

          const innerSend = Effect.gen(function* () {
            yield* channel.send(message)
            yield* Deferred.succeed(sentDeferred, void 0)
          })

          yield* innerSend.pipe(Effect.timeout(100), Effect.retry(Schedule.exponential(100)), Effect.orDie)
        }).pipe(Effect.tapErrorCause(Effect.logError))

        const rerunOnNewChannelFiber = yield* internalChannelSref.changes.pipe(
          Stream.filter((_) => _ === false),
          Stream.tap(() => FiberHandle.run(sendFiberHandle, trySend)),
          Stream.runDrain,
          Effect.fork,
        )

        yield* FiberHandle.run(sendFiberHandle, trySend)

        yield* sentDeferred

        yield* Fiber.interrupt(rerunOnNewChannelFiber)
      }).pipe(Effect.scoped, Effect.withParentSpan(parentSpan))

    const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right))

    const closedDeferred = yield* Deferred.make<void>()

    const webChannel = {
      [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
      send,
      listen,
      closedDeferred,
      supportsTransferables: true,
      schema,
    } satisfies WebChannel.WebChannel<any, any>

    return webChannel as WebChannel.WebChannel<any, any>
  }).pipe(Effect.withSpanScoped('makeMessageChannel'))
