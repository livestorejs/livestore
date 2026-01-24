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
  type ProxyQueueItem,
  packetAsOtelAttributes,
} from '../common.ts'
import * as MeshSchema from '../mesh-schema.ts'

/**
 * Simulation parameters for proxy channel operations.
 * Used for testing race conditions and timing-sensitive behavior.
 *
 * Each parameter represents a delay (in ms) injected at a specific point in the code.
 * Values are bounded 0-500ms to prevent tests from running too long.
 */
export const ProxyChannelSimulationParams = Schema.Struct({
  /**
   * Delays related to receiving and processing payload messages
   */
  onPayload: Schema.Struct({
    /** Delay before sending the ACK response (simulates slow ACK send) */
    beforeAckSend: Schema.Int.pipe(Schema.between(0, 500)),
    /** Delay after forking the ACK send, before adding message to listen queue */
    afterAckFork: Schema.Int.pipe(Schema.between(0, 500)),
    /** Delay after adding message to listen queue */
    afterListenQueueOffer: Schema.Int.pipe(Schema.between(0, 500)),
  }),
})

export type ProxyChannelSimulationParams = typeof ProxyChannelSimulationParams.Type

/** Default simulation params with no delays */
export const defaultSimulationParams: ProxyChannelSimulationParams = {
  onPayload: {
    beforeAckSend: 0,
    afterAckFork: 0,
    afterListenQueueOffer: 0,
  },
}

interface MakeProxyChannelArgs {
  queue: Queue.Queue<ProxyQueueItem>
  nodeName: MeshNodeName
  newEdgeAvailablePubSub: PubSub.PubSub<MeshNodeName>
  sendPacket: (packet: typeof MeshSchema.ProxyChannelPacket.Type) => Effect.Effect<void>
  channelName: ChannelName
  target: MeshNodeName
  schema: {
    send: Schema.Schema<any, any>
    listen: Schema.Schema<any, any>
  }
  /** Optional simulation parameters for testing timing-sensitive behavior */
  simulation?: ProxyChannelSimulationParams
}

export const makeProxyChannel = ({
  queue,
  nodeName,
  newEdgeAvailablePubSub,
  sendPacket,
  target,
  channelName,
  schema,
  simulation = defaultSimulationParams,
}: MakeProxyChannelArgs) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      /** Helper to inject simulation delays at specific code points */
      const simSleep = <TKey extends keyof ProxyChannelSimulationParams>(
        key: TKey,
        key2: keyof ProxyChannelSimulationParams[TKey],
      ) => {
        const delay = (simulation[key]?.[key2] ?? 0) as number
        return delay > 0 ? Effect.sleep(delay) : Effect.void
      }
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
        kind: 'proxy-channel',
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
          // TODO avoid "double" `Connected` events (we might call `setStateToEstablished` twice during initial edge)
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

      const edgeRequest = Effect.suspend(() =>
        sendPacket(
          MeshSchema.ProxyChannelRequest.make({ channelName, hops: [], source: nodeName, target, channelIdCandidate }),
        ),
      )

      const getCombinedChannelId = (otherSideChannelIdCandidate: string) =>
        [channelIdCandidate, otherSideChannelIdCandidate].sort().join('_')

      const earlyPayloadBuffer = yield* Queue.unbounded<typeof MeshSchema.ProxyChannelPayload.Type>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const processProxyPacket = ({ packet, respondToSender }: ProxyQueueItem) =>
        Effect.gen(function* () {
          // yield* Effect.logDebug(
          //   `[${nodeName}] processProxyPacket received: ${packet._tag} from ${packet.source} (reqId: ${packet.id})`,
          // )

          const otherSideName = packet.source
          const channelKey = `target:${otherSideName}, channelName:${packet.channelName}` satisfies ChannelKey
          const channelState = channelStateRef.current

          switch (packet._tag) {
            case 'ProxyChannelRequest': {
              const combinedChannelId = getCombinedChannelId(packet.channelIdCandidate)

              // Handle Established state explicitly
              if (channelState._tag === 'Established') {
                // Check if the incoming request is for the *same* channel instance
                if (channelState.combinedChannelId === combinedChannelId) {
                  // Already established with the same ID, likely a redundant request.
                  // Just respond and stay established.
                  // yield* Effect.logDebug(
                  //   `[${nodeName}] Received redundant ProxyChannelRequest for already established channel instance ${combinedChannelId}. Responding.`,
                  // )
                } else {
                  // Established, but the incoming request has a different ID.
                  // This implies a reconnect scenario where IDs don't match. Reset to Pending and re-initiate.
                  yield* Effect.logWarning(
                    `[${nodeName}] Received ProxyChannelRequest with different channel ID (${combinedChannelId}) while established with ${channelState.combinedChannelId}. Re-establishing.`,
                  )
                  yield* SubscriptionRef.set(connectedStateRef, false)
                  channelStateRef.current = { _tag: 'Pending', initiatedVia: 'incoming-request' }
                  yield* Effect.spanEvent(`Reconnecting (received conflicting ProxyChannelRequest)`).pipe(
                    Effect.withParentSpan(channelSpan),
                  )
                  debugInfo.isConnected = false
                  debugInfo.connectCounter++
                  // We need to send our own request as well to complete the handshake for the new ID
                  yield* edgeRequest
                }
              } else if (channelState._tag === 'Initial') {
                // Standard initial connection: set to Pending
                yield* SubscriptionRef.set(connectedStateRef, false) // Ensure connectedStateRef is false if we were somehow Initial but it wasn't false
                channelStateRef.current = { _tag: 'Pending', initiatedVia: 'incoming-request' }
                yield* Effect.spanEvent(`Connecting (received ProxyChannelRequest)`).pipe(
                  Effect.withParentSpan(channelSpan),
                )
                debugInfo.isConnected = false // Should be false already, but ensure consistency
                debugInfo.connectCounter++
                // No need to send edgeRequest here, the response acts as our part of the handshake for the incoming request's ID
              }
              // If state is 'Pending', we are already trying to connect.
              // Just let the response go out, don't change state.

              // Send the response regardless of the initial state (unless an error occurred)
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
                if (
                  channelState._tag === 'Established' &&
                  channelState.combinedChannelId !== packet.combinedChannelId
                ) {
                  return shouldNeverHappen(
                    `ProxyChannel[${channelKey}]: Expected proxy channel to have the same combinedChannelId as the packet:\n${channelState.combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                  )
                } else if (channelState._tag === 'Established') {
                  // yield* Effect.logDebug(`[${nodeName}] Ignoring redundant ResponseSuccess with same ID ${packet.id}`)
                  return
                } else {
                  yield* Effect.logWarning(
                    `[${nodeName}] Ignoring ResponseSuccess ${packet.id} received in unexpected state ${channelState._tag}`,
                  )
                  return
                }
              }

              const combinedChannelId = getCombinedChannelId(packet.channelIdCandidate)
              if (combinedChannelId !== packet.combinedChannelId) {
                return yield* Effect.die(
                  `ProxyChannel[${channelKey}]: Expected proxy channel to have the same combinedChannelId as the packet:\n${combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                )
              }

              yield* setStateToEstablished(packet.combinedChannelId)

              const establishedState = channelStateRef.current
              if (establishedState._tag === 'Established') {
                //
                const bufferedPackets = yield* Queue.takeAll(earlyPayloadBuffer)
                // yield* Effect.logDebug(
                //   `[${nodeName}] Draining early payload buffer (${bufferedPackets.length}) after ResponseSuccess`,
                // )
                for (const bufferedPacket of bufferedPackets) {
                  if (establishedState.combinedChannelId !== bufferedPacket.combinedChannelId) {
                    yield* Effect.logWarning(
                      `[${nodeName}] Discarding buffered payload ${bufferedPacket.id}: Combined channel ID mismatch during drain. Expected ${establishedState.combinedChannelId}, got ${bufferedPacket.combinedChannelId}`,
                    )
                    continue
                  }
                  const decodedMessage = yield* Schema.decodeUnknown(establishedState.listenSchema)(
                    bufferedPacket.payload,
                  )
                  yield* establishedState.listenQueue.pipe(Queue.offer(decodedMessage))
                }
              } else {
                yield* Effect.logError(
                  `[${nodeName}] State is not Established immediately after setStateToEstablished was called. Cannot drain buffer. State: ${establishedState._tag}`,
                )
              }

              return
            }
            case 'ProxyChannelPayload': {
              if (channelState._tag === 'Established' && channelState.combinedChannelId !== packet.combinedChannelId) {
                return yield* Effect.die(
                  `ProxyChannel[${channelKey}]: Expected proxy channel to have the same combinedChannelId as the packet:\n${channelState.combinedChannelId} (channel) === ${packet.combinedChannelId} (packet)`,
                )
              }

              // Send ACK fire-and-forget to avoid blocking message processing
              // This is critical because blocking ACK sends can prevent messages from reaching the listen queue
              // See test: "ACK forkScoped regression tests" for documentation

              // The ACK send effect with optional simulation delay INSIDE the fork
              // This is key for testing: with forkScoped, the delay happens in background and doesn't block message processing
              // Without forkScoped (blocking), the delay would block the message from being added to listen queue
              const ackSendEffect = Effect.gen(function* () {
                yield* simSleep('onPayload', 'beforeAckSend')
                yield* respondToSender(
                  MeshSchema.ProxyChannelPayloadAck.make({
                    reqId: packet.id,
                    remainingHops: packet.hops,
                    hops: [],
                    target,
                    source: nodeName,
                    channelName,
                    combinedChannelId:
                      channelState._tag === 'Established' ? channelState.combinedChannelId : packet.combinedChannelId,
                  }),
                )
              })

              yield* ackSendEffect.pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

              // Simulation point: delay after forking ACK (before processing message)
              yield* simSleep('onPayload', 'afterAckFork')

              if (channelState._tag === 'Established') {
                const decodedMessage = yield* Schema.decodeUnknown(channelState.listenSchema)(packet.payload)
                yield* channelState.listenQueue.pipe(Queue.offer(decodedMessage))

                // Simulation point: delay after adding to listen queue
                yield* simSleep('onPayload', 'afterListenQueueOffer')
              } else {
                yield* Queue.offer(earlyPayloadBuffer, packet)
              }
              return
            }
            case 'ProxyChannelPayloadAck': {
              if (channelState._tag !== 'Established') {
                yield* Effect.spanEvent(`Not yet connected to ${target}. dropping message`)
                yield* Effect.logWarning(
                  `[${nodeName}] Received Ack but not established (State: ${channelState._tag}). Dropping Ack for ${packet.reqId}`,
                )
                return
              }

              // Handle missing ACK gracefully - can happen with synthetic ACKs from relay or duplicate ACKs
              const ack = channelState.ackMap.get(packet.reqId)
              if (ack === undefined) {
                yield* Effect.logDebug(
                  `Received ACK for unknown reqId: ${packet.reqId} (may be synthetic or duplicate)`,
                )
                return
              }
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
      // which indicates we already have a edge to the target node
      // const channelState = channelStateRef.current
      {
        if (channelStateRef.current._tag !== 'Initial') {
          return shouldNeverHappen('Expected proxy channel to be Initial')
        }

        channelStateRef.current = { _tag: 'Pending', initiatedVia: 'outgoing-request' }

        yield* edgeRequest

        const retryOnNewEdgeFiber = yield* Stream.fromPubSub(newEdgeAvailablePubSub).pipe(
          Stream.tap(() => edgeRequest),
          Stream.runDrain,
          Effect.forkScoped,
        )

        const { combinedChannelId: channelId } = yield* waitForEstablished

        yield* Fiber.interrupt(retryOnNewEdgeFiber)

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
              // TODO consider handling previous ackMap entries which might leak/fill-up memory
              // as only successful acks are removed from the map
              ackMap.set(packet.id, ack)

              yield* sendPacket(packet)

              yield* ack
              yield* Deferred.succeed(sentDeferred, void 0)

              debugInfo.pendingSends--
            })

            // TODO make this configurable
            // Schedule.exponential(10): 10, 20, 40, 80, 160, 320, ...
            yield* innerSend.pipe(Effect.timeout(100), Effect.retry(Schedule.exponential(10)), Effect.orDie)
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

      const runtime = yield* Effect.runtime()

      const webChannel = {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        supportsTransferables: false,
        schema,
        shutdown: Scope.close(scope, Exit.void),
        debugInfo,
        ...({
          debug: {
            ping: (message = 'ping') =>
              send(WebChannel.DebugPingMessage.make({ message })).pipe(
                Effect.provide(runtime),
                Effect.tapCauseLogPretty,
                Effect.runFork,
              ),
          },
        } as {}),
      } satisfies WebChannel.WebChannel<any, any>

      return webChannel as WebChannel.WebChannel<any, any>
    }).pipe(Effect.withSpanScoped('makeProxyChannel')),
  )
