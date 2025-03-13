import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import type { PubSub } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  Either,
  Exit,
  Fiber,
  FiberHandle,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import {
  type ChannelKey,
  type ChannelName,
  type MeshNodeName,
  packetAsOtelAttributes,
  type ProxyQueueItem,
} from '../common.js'
import * as MeshSchema from '../mesh-schema.js'

interface MakeProxyChannelArgs {
  queue: Queue.Queue<ProxyQueueItem>
  nodeName: MeshNodeName
  newConnectionAvailablePubSub: PubSub.PubSub<MeshNodeName>
  sendPacket: (packet: typeof MeshSchema.ProxyChannelPacket.Type) => Effect.Effect<void>
  channelName: ChannelName
  target: MeshNodeName
  schema: {
    send: Schema.Schema<any, any>
    listen: Schema.Schema<any, any>
  }
}

export const makeProxyChannel = ({
  queue,
  nodeName,
  newConnectionAvailablePubSub,
  sendPacket,
  target,
  channelName,
  schema,
}: MakeProxyChannelArgs) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      type ProxiedChannelState =
        | {
            _tag: 'Initial'
          }
        | {
            _tag: 'Pending'
            initiatedVia: 'outgoing-request' | 'incoming-request'
          }
        | ProxiedChannelStateEstablished

      type ProxiedChannelStateEstablished = {
        _tag: 'Established'
        listenSchema: Schema.Schema<any, any>
        listenQueue: Queue.Queue<any>
        ackMap: Map<string, Deferred.Deferred<void, never>>
        combinedChannelId: string
      }

      const channelStateRef = { current: { _tag: 'Initial' } as ProxiedChannelState }

      const debugInfo = {
        pendingSends: 0,
        totalSends: 0,
        connectCounter: 0,
        isConnected: false,
      }

      /**
       * We need to unique identify a channel as multiple channels might exist between the same two nodes.
       * We do this by letting each channel end generate a unique id and then combining them in a deterministic way.
       */
      const channelIdCandidate = nanoid(5)
      yield* Effect.annotateCurrentSpan({ channelIdCandidate })

      const channelSpan = yield* Effect.currentSpan.pipe(Effect.orDie)

      const connectedStateRef = yield* SubscriptionRef.make<ProxiedChannelStateEstablished | false>(false)

      const waitForEstablished = Effect.gen(function* () {
        const state = yield* SubscriptionRef.waitUntil(connectedStateRef, (state) => state !== false)

        return state as ProxiedChannelStateEstablished
      })

      const setStateToEstablished = (channelId: string) =>
        Effect.gen(function* () {
          // TODO avoid "double" `Connected` events (we might call `setStateToEstablished` twice during initial connection)
          yield* Effect.spanEvent(`Connected (${channelId})`).pipe(Effect.withParentSpan(channelSpan))
          channelStateRef.current = {
            _tag: 'Established',
            listenSchema: schema.listen,
            listenQueue,
            ackMap,
            combinedChannelId: channelId,
          }
          yield* SubscriptionRef.set(connectedStateRef, channelStateRef.current)
          debugInfo.isConnected = true
        })

      const connectionRequest = Effect.suspend(() =>
        sendPacket(
          MeshSchema.ProxyChannelRequest.make({ channelName, hops: [], source: nodeName, target, channelIdCandidate }),
        ),
      )

      const getCombinedChannelId = (otherSideChannelIdCandidate: string) =>
        [channelIdCandidate, otherSideChannelIdCandidate].sort().join('_')

      const processProxyPacket = ({ packet, respondToSender }: ProxyQueueItem) =>
        Effect.gen(function* () {
          // yield* Effect.log(`${nodeName}:processing packet ${packet._tag} from ${packet.source}`)

          const otherSideName = packet.source
          const channelKey = `target:${otherSideName}, channelName:${packet.channelName}` satisfies ChannelKey
          const channelState = channelStateRef.current

          switch (packet._tag) {
            case 'ProxyChannelRequest': {
              const combinedChannelId = getCombinedChannelId(packet.channelIdCandidate)

              if (channelState._tag === 'Initial' || channelState._tag === 'Established') {
                yield* SubscriptionRef.set(connectedStateRef, false)
                channelStateRef.current = { _tag: 'Pending', initiatedVia: 'incoming-request' }
                yield* Effect.spanEvent(`Reconnecting`).pipe(Effect.withParentSpan(channelSpan))
                debugInfo.isConnected = false
                debugInfo.connectCounter++

                // If we're already connected, we need to re-establish the connection
                if (channelState._tag === 'Established' && channelState.combinedChannelId !== combinedChannelId) {
                  yield* connectionRequest
                }
              }

              yield* respondToSender(
                MeshSchema.ProxyChannelResponseSuccess.make({
                  reqId: packet.id,
                  remainingHops: packet.hops,
                  hops: [],
                  target,
                  source: nodeName,
                  channelName,
                  combinedChannelId,
                  channelIdCandidate,
                }),
              )

              return
            }
            case 'ProxyChannelResponseSuccess': {
              if (channelState._tag !== 'Pending') {
                // return shouldNeverHappen(`Expected proxy channel to be pending but got ${channelState._tag}`)
                if (
                  channelState._tag === 'Established' &&
                  channelState.combinedChannelId !== packet.combinedChannelId
                ) {
                  return shouldNeverHappen(
                    `Expected proxy channel to have the same combinedChannelId as the packet:\n${channelState.combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                  )
                } else {
                  // for now just ignore it but should be looked into (there seems to be some kind of race condition/inefficiency)
                }
              }

              const combinedChannelId = getCombinedChannelId(packet.channelIdCandidate)
              if (combinedChannelId !== packet.combinedChannelId) {
                return yield* Effect.die(
                  `Expected proxy channel to have the same combinedChannelId as the packet:\n${combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                )
              }

              yield* setStateToEstablished(packet.combinedChannelId)

              return
            }
            case 'ProxyChannelPayload': {
              if (channelState._tag !== 'Established') {
                // return yield* Effect.die(`Not yet connected to ${target}. dropping message`)
                yield* Effect.spanEvent(`Not yet connected to ${target}. dropping message`, { packet })
                return
              }

              if (channelState.combinedChannelId !== packet.combinedChannelId) {
                return yield* Effect.die(
                  `Expected proxy channel to have the same combinedChannelId as the packet:\n${channelState.combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                )
              }

              yield* respondToSender(
                MeshSchema.ProxyChannelPayloadAck.make({
                  reqId: packet.id,
                  remainingHops: packet.hops,
                  hops: [],
                  target,
                  source: nodeName,
                  channelName,
                  combinedChannelId: channelState.combinedChannelId,
                }),
              )

              const decodedMessage = yield* Schema.decodeUnknown(channelState.listenSchema)(packet.payload)
              yield* channelState.listenQueue.pipe(Queue.offer(decodedMessage))

              return
            }
            case 'ProxyChannelPayloadAck': {
              if (channelState._tag !== 'Established') {
                yield* Effect.spanEvent(`Not yet connected to ${target}. dropping message`)
                return
              }

              const ack =
                channelState.ackMap.get(packet.reqId) ??
                shouldNeverHappen(`Expected ack for ${packet.reqId} in proxy channel ${channelKey}`)

              yield* Deferred.succeed(ack, void 0)

              channelState.ackMap.delete(packet.reqId)

              return
            }
            default: {
              return casesHandled(packet)
            }
          }
        }).pipe(
          Effect.withSpan(`handleProxyPacket:${packet._tag}:${packet.source}->${packet.target}`, {
            attributes: packetAsOtelAttributes(packet),
          }),
        )

      yield* Stream.fromQueue(queue).pipe(
        Stream.tap(processProxyPacket),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const listenQueue = yield* Queue.unbounded<any>()

      yield* Effect.spanEvent(`Connecting`)

      const ackMap = new Map<string, Deferred.Deferred<void, never>>()

      // check if already established via incoming `ProxyChannelRequest` from other side
      // which indicates we already have a connection to the target node
      // const channelState = channelStateRef.current
      {
        if (channelStateRef.current._tag !== 'Initial') {
          return shouldNeverHappen('Expected proxy channel to be Initial')
        }

        channelStateRef.current = { _tag: 'Pending', initiatedVia: 'outgoing-request' }

        yield* connectionRequest

        const retryOnNewConnectionFiber = yield* Stream.fromPubSub(newConnectionAvailablePubSub).pipe(
          Stream.tap(() => connectionRequest),
          Stream.runDrain,
          Effect.forkScoped,
        )

        const { combinedChannelId: channelId } = yield* waitForEstablished

        yield* Fiber.interrupt(retryOnNewConnectionFiber)

        yield* setStateToEstablished(channelId)
      }

      const send = (message: any) =>
        Effect.gen(function* () {
          const payload = yield* Schema.encodeUnknown(schema.send)(message)
          const sendFiberHandle = yield* FiberHandle.make<void, never>()

          const sentDeferred = yield* Deferred.make<void>()

          debugInfo.pendingSends++
          debugInfo.totalSends++

          const trySend = Effect.gen(function* () {
            const { combinedChannelId } = (yield* SubscriptionRef.waitUntil(
              connectedStateRef,
              (channel) => channel !== false,
            )) as ProxiedChannelStateEstablished

            const innerSend = Effect.gen(function* () {
              // Note we're re-creating new packets every time otherwise they will be skipped because of `handledIds`
              const ack = yield* Deferred.make<void, never>()
              const packet = MeshSchema.ProxyChannelPayload.make({
                channelName,
                payload,
                hops: [],
                source: nodeName,
                target,
                combinedChannelId,
              })
              ackMap.set(packet.id, ack)

              yield* sendPacket(packet)

              yield* ack
              yield* Deferred.succeed(sentDeferred, void 0)

              debugInfo.pendingSends--
            })

            yield* innerSend.pipe(Effect.timeout(100), Effect.retry(Schedule.exponential(100)), Effect.orDie)
          }).pipe(Effect.tapErrorCause(Effect.logError))

          const rerunOnNewChannelFiber = yield* connectedStateRef.changes.pipe(
            Stream.filter((_) => _ === false),
            Stream.tap(() => FiberHandle.run(sendFiberHandle, trySend)),
            Stream.runDrain,
            Effect.fork,
          )

          yield* FiberHandle.run(sendFiberHandle, trySend)

          yield* sentDeferred

          yield* Fiber.interrupt(rerunOnNewChannelFiber)
        }).pipe(
          Effect.scoped,
          Effect.withSpan(`sendAckWithRetry:ProxyChannelPayload`),
          Effect.withParentSpan(channelSpan),
        )

      const listen = Stream.fromQueue(listenQueue).pipe(Stream.map(Either.right))

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      const webChannel = {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        supportsTransferables: true,
        schema,
        shutdown: Scope.close(scope, Exit.void),
        debugInfo,
      } satisfies WebChannel.WebChannel<any, any>

      return webChannel as WebChannel.WebChannel<any, any>
    }).pipe(Effect.withSpanScoped('makeProxyChannel')),
  )
