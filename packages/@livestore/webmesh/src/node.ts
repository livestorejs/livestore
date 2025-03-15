import { indent, LS_DEV, shouldNeverHappen } from '@livestore/utils'
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  PubSub,
  Queue,
  Schema,
  Scope,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'

import { makeMessageChannel } from './channel/message-channel.js'
import { makeProxyChannel } from './channel/proxy-channel.js'
import type { ChannelKey, MeshNodeName, MessageQueueItem, ProxyQueueItem } from './common.js'
import { EdgeAlreadyExistsError, packetAsOtelAttributes } from './common.js'
import * as WebmeshSchema from './mesh-schema.js'
import { TimeoutSet } from './utils.js'

type EdgeChannel = WebChannel.WebChannel<typeof WebmeshSchema.Packet.Type, typeof WebmeshSchema.Packet.Type>

export interface MeshNode<TName extends MeshNodeName = MeshNodeName> {
  nodeName: TName

  edgeKeys: Effect.Effect<Set<MeshNodeName>>

  debug: {
    print: () => void
    /** Sends a ping message to all connected nodes and channels */
    ping: (payload?: string) => void
    /**
     * Requests the topology of the network from all connected nodes
     */
    requestTopology: (timeoutMs?: number) => Promise<void>
  }

  /**
   * Manually adds a edge to get connected to the network of nodes with an existing WebChannel.
   *
   * Assumptions about the WebChannel edge:
   * - 1:1 edge
   * - Queues messages internally to never drop messages
   * - Automatically reconnects
   * - Ideally supports transferables
   */
  addEdge: {
    (options: {
      target: MeshNodeName
      edgeChannel: EdgeChannel
      replaceIfExists: true
    }): Effect.Effect<void, never, Scope.Scope>
    (options: {
      target: MeshNodeName
      edgeChannel: EdgeChannel
      replaceIfExists?: boolean
    }): Effect.Effect<void, EdgeAlreadyExistsError, Scope.Scope>
  }

  removeEdge: (targetNodeName: MeshNodeName) => Effect.Effect<void, Cause.NoSuchElementException>

  /**
   * Tries to broker a MessageChannel edge between the nodes, otherwise will proxy messages via hop-nodes
   *
   * For a channel to successfully open, both sides need to have a edge and call `makeChannel`.
   *
   * Example:
   * ```ts
   * // Code on node A
   * const channel = nodeA.makeChannel({ target: 'B', channelName: 'my-channel', schema: ... })
   *
   * // Code on node B
   * const channel = nodeB.makeChannel({ target: 'A', channelName: 'my-channel', schema: ... })
   * ```
   */
  makeChannel: <MsgListen, MsgSend>(args: {
    target: MeshNodeName
    /**
     * A name for the channel (same from both sides).
     * Needs to be unique in the context of the 2 connected nodes.
     */
    channelName: string
    schema:
      | Schema.Schema<MsgListen | MsgSend, any>
      | {
          listen: Schema.Schema<MsgListen, any>
          send: Schema.Schema<MsgSend, any>
        }
    /**
     * If possible, prefer using a MessageChannel with transferables (i.e. transferring memory instead of copying it).
     */
    mode: 'messagechannel' | 'proxy'
    /**
     * Amount of time before we consider a channel creation failed and retry when a new edge is available
     *
     * @default 1 second
     */
    timeout?: Duration.DurationInput
  }) => Effect.Effect<WebChannel.WebChannel<MsgListen, MsgSend>, never, Scope.Scope>

  /**
   * Creates a WebChannel that is broadcasted to all connected nodes.
   * Messages won't be buffered for nodes that join the network after the broadcast channel has been created.
   */
  makeBroadcastChannel: <Msg>(args: {
    channelName: string
    schema: Schema.Schema<Msg, any>
  }) => Effect.Effect<WebChannel.WebChannel<Msg, Msg>, never, Scope.Scope>
}

export const makeMeshNode = <TName extends MeshNodeName>(
  nodeName: TName,
): Effect.Effect<MeshNode<TName>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const edgeChannels = new Map<MeshNodeName, { channel: EdgeChannel; listenFiber: Fiber.RuntimeFiber<void> }>()

    // To avoid unbounded memory growth, we automatically forget about packet ids after a while
    const handledPacketIds = new TimeoutSet<string>({ timeout: Duration.minutes(1) })

    const newEdgeAvailablePubSub = yield* PubSub.unbounded<MeshNodeName>().pipe(Effect.acquireRelease(PubSub.shutdown))

    // const proxyPacketsToProcess = yield* Queue.unbounded<ProxyQueueItem>().pipe(Effect.acquireRelease(Queue.shutdown))
    // const messagePacketsToProcess = yield* Queue.unbounded<MessageQueueItem>().pipe(
    //   Effect.acquireRelease(Queue.shutdown),
    // )

    const channelMap = new Map<
      ChannelKey,
      {
        queue: Queue.Queue<MessageQueueItem | ProxyQueueItem>
        /** This reference is only kept for debugging purposes */
        debugInfo:
          | {
              channel: WebChannel.WebChannel<any, any>
              target: MeshNodeName
            }
          | undefined
      }
    >()

    type RequestId = string
    const topologyRequestsMap = new Map<RequestId, Map<MeshNodeName, Set<MeshNodeName>>>()

    type BroadcastChannelName = string
    const broadcastChannelListenQueueMap = new Map<BroadcastChannelName, Queue.Queue<any>>()

    const checkTransferableEdges = (packet: typeof WebmeshSchema.MessageChannelPacket.Type) => {
      if (
        (packet._tag === 'MessageChannelRequest' &&
          (edgeChannels.size === 0 ||
            // Either if direct edge does not support transferables ...
            edgeChannels.get(packet.target)?.channel.supportsTransferables === false)) ||
        // ... or if no forward-edges support transferables
        ![...edgeChannels.values()].some((c) => c.channel.supportsTransferables === true)
      ) {
        return WebmeshSchema.MessageChannelResponseNoTransferables.make({
          reqId: packet.id,
          channelName: packet.channelName,
          // NOTE for now we're "pretending" that the message is coming from the target node
          // even though we're already handling it here.
          // TODO we should clean this up at some point
          source: packet.target,
          // source: nodeName,
          target: packet.source,
          remainingHops: packet.hops,
          hops: [],
        })
      }
    }

    const sendPacket = (packet: typeof WebmeshSchema.Packet.Type) =>
      Effect.gen(function* () {
        // yield* Effect.log(`${nodeName}: sendPacket:${packet._tag} [${packet.id}]`)

        if (Schema.is(WebmeshSchema.NetworkEdgeAdded)(packet)) {
          yield* Effect.spanEvent('NetworkEdgeAdded', { packet, nodeName })
          yield* PubSub.publish(newEdgeAvailablePubSub, packet.target)

          const edgesToForwardTo = Array.from(edgeChannels)
            .filter(([name]) => name !== packet.source)
            .map(([_, con]) => con.channel)

          yield* Effect.forEach(edgesToForwardTo, (con) => con.send(packet), { concurrency: 'unbounded' })
          return
        }

        if (Schema.is(WebmeshSchema.BroadcastChannelPacket)(packet)) {
          const edgesToForwardTo = Array.from(edgeChannels)
            .filter(([name]) => !packet.hops.includes(name))
            .map(([_, con]) => con.channel)

          const adjustedPacket = {
            ...packet,
            hops: [...packet.hops, nodeName],
          }

          yield* Effect.forEach(edgesToForwardTo, (con) => con.send(adjustedPacket), { concurrency: 'unbounded' })

          // Don't emit the packet to the own node listen queue
          if (packet.source === nodeName) {
            return
          }

          const queue = broadcastChannelListenQueueMap.get(packet.channelName)
          // In case this node is listening to this channel, add the packet to the listen queue
          if (queue !== undefined) {
            yield* Queue.offer(queue, packet)
          }

          return
        }

        if (Schema.is(WebmeshSchema.NetworkTopologyRequest)(packet)) {
          if (packet.source !== nodeName) {
            const backEdgeName =
              packet.hops.at(-1) ?? shouldNeverHappen(`${nodeName}: Expected hops for packet`, packet)
            const backEdgeChannel = edgeChannels.get(backEdgeName)!.channel

            // Respond with own edge info
            const response = WebmeshSchema.NetworkTopologyResponse.make({
              reqId: packet.id,
              source: packet.source,
              target: packet.target,
              remainingHops: packet.hops.slice(0, -1),
              nodeName,
              edges: Array.from(edgeChannels.keys()),
            })

            yield* backEdgeChannel.send(response)
          }

          // Forward the packet to all edges except the already visited ones
          const edgesToForwardTo = Array.from(edgeChannels)
            .filter(([name]) => !packet.hops.includes(name))
            .map(([_, con]) => con.channel)

          const adjustedPacket = {
            ...packet,
            hops: [...packet.hops, nodeName],
          }

          yield* Effect.forEach(edgesToForwardTo, (con) => con.send(adjustedPacket), { concurrency: 'unbounded' })

          return
        }

        if (Schema.is(WebmeshSchema.NetworkTopologyResponse)(packet)) {
          if (packet.source === nodeName) {
            const topologyRequestItem = topologyRequestsMap.get(packet.reqId)!
            topologyRequestItem.set(packet.nodeName, new Set(packet.edges))
          } else {
            const remainingHops = packet.remainingHops
            // Forwarding the response to the original sender via the route back
            const routeBack =
              remainingHops.at(-1) ?? shouldNeverHappen(`${nodeName}: Expected remaining hops for packet`, packet)
            const edgeChannel =
              edgeChannels.get(routeBack)?.channel ??
              shouldNeverHappen(
                `${nodeName}: Expected edge channel (${routeBack}) for packet`,
                packet,
                'Available edges:',
                Array.from(edgeChannels.keys()),
              )

            yield* edgeChannel.send({ ...packet, remainingHops: packet.remainingHops.slice(0, -1) })
          }
          return
        }

        // We have a direct edge to the target node
        if (edgeChannels.has(packet.target)) {
          const edgeChannel = edgeChannels.get(packet.target)!.channel
          const hops = packet.source === nodeName ? [] : [...packet.hops, nodeName]
          yield* edgeChannel.send({ ...packet, hops })
        }
        // In this case we have an expected route back we should follow
        // eslint-disable-next-line unicorn/no-negated-condition
        else if (packet.remainingHops !== undefined) {
          const hopTarget =
            packet.remainingHops.at(-1) ?? shouldNeverHappen(`${nodeName}: Expected remaining hops for packet`, packet)
          const edgeChannel = edgeChannels.get(hopTarget)?.channel

          if (edgeChannel === undefined) {
            yield* Effect.logWarning(
              `${nodeName}: Expected to find hop target ${hopTarget} in edges. Dropping packet.`,
              packet,
            )
            return
          }

          yield* edgeChannel.send({
            ...packet,
            remainingHops: packet.remainingHops.slice(0, -1),
            hops: [...packet.hops, nodeName],
          })
        }
        // No route found, forward to all edges
        else {
          const hops = packet.source === nodeName ? [] : [...packet.hops, nodeName]

          // Optimization: filter out edge where packet just came from
          const edgesToForwardTo = Array.from(edgeChannels)
            .filter(([name]) => name !== packet.source)
            .map(([_, con]) => con.channel)

          // TODO if hops-depth=0, we should fail right away with no route found
          if (hops.length === 0 && edgesToForwardTo.length === 0 && LS_DEV) {
            console.log(nodeName, 'no route found', packet._tag, 'TODO handle better')
            // TODO return a expected failure
          }

          const packetToSend = { ...packet, hops }
          // console.debug(nodeName, 'sendPacket:forwarding', packetToSend)

          yield* Effect.forEach(edgesToForwardTo, (con) => con.send(packetToSend), { concurrency: 'unbounded' })
        }
      }).pipe(
        Effect.withSpan(`sendPacket:${packet._tag}:${packet.source}→${packet.target}`, {
          attributes: packetAsOtelAttributes(packet),
        }),
        Effect.orDie,
      )

    const addEdge: MeshNode['addEdge'] = ({ target: targetNodeName, edgeChannel, replaceIfExists = false }) =>
      Effect.gen(function* () {
        if (edgeChannels.has(targetNodeName)) {
          if (replaceIfExists) {
            yield* removeEdge(targetNodeName).pipe(Effect.orDie)
            // console.log('interrupting', targetNodeName)
            // yield* Fiber.interrupt(edgeChannels.get(targetNodeName)!.listenFiber)
          } else {
            return yield* new EdgeAlreadyExistsError({ target: targetNodeName })
          }
        }

        // TODO use a priority queue instead to prioritize network-changes/edge-requests over payloads
        const listenFiber = yield* edgeChannel.listen.pipe(
          Stream.flatten(),
          Stream.tap((message) =>
            Effect.gen(function* () {
              const packet = yield* Schema.decodeUnknown(WebmeshSchema.Packet)(message)

              // console.debug(nodeName, 'received', packet._tag, packet.source, packet.target)

              if (handledPacketIds.has(packet.id)) return
              handledPacketIds.add(packet.id)

              switch (packet._tag) {
                case 'NetworkEdgeAdded':
                case 'NetworkTopologyRequest':
                case 'NetworkTopologyResponse': {
                  yield* sendPacket(packet)

                  break
                }
                default: {
                  if (packet.target === nodeName) {
                    const channelKey = `target:${packet.source}, channelName:${packet.channelName}` satisfies ChannelKey

                    if (!channelMap.has(channelKey)) {
                      const queue = yield* Queue.unbounded<MessageQueueItem | ProxyQueueItem>().pipe(
                        Effect.acquireRelease(Queue.shutdown),
                      )
                      channelMap.set(channelKey, { queue, debugInfo: undefined })
                    }

                    const queue = channelMap.get(channelKey)!.queue

                    const respondToSender = (outgoingPacket: typeof WebmeshSchema.Packet.Type) =>
                      edgeChannel
                        .send(outgoingPacket)
                        .pipe(
                          Effect.withSpan(
                            `respondToSender:${outgoingPacket._tag}:${outgoingPacket.source}→${outgoingPacket.target}`,
                            { attributes: packetAsOtelAttributes(outgoingPacket) },
                          ),
                          Effect.orDie,
                        )

                    if (Schema.is(WebmeshSchema.ProxyChannelPacket)(packet)) {
                      yield* Queue.offer(queue, { packet, respondToSender })
                    } else if (Schema.is(WebmeshSchema.MessageChannelPacket)(packet)) {
                      yield* Queue.offer(queue, { packet, respondToSender })
                    }
                  } else {
                    if (Schema.is(WebmeshSchema.MessageChannelPacket)(packet)) {
                      const noTransferableResponse = checkTransferableEdges(packet)
                      if (noTransferableResponse !== undefined) {
                        yield* Effect.spanEvent(`No transferable edges found for ${packet.source}→${packet.target}`)
                        return yield* edgeChannel.send(noTransferableResponse).pipe(
                          Effect.withSpan(`sendNoTransferableResponse:${packet.source}→${packet.target}`, {
                            attributes: packetAsOtelAttributes(noTransferableResponse),
                          }),
                        )
                      }
                    }

                    yield* sendPacket(packet)
                  }
                }
              }
            }),
          ),
          Stream.runDrain,
          Effect.orDie,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        edgeChannels.set(targetNodeName, { channel: edgeChannel, listenFiber })

        const edgeAddedPacket = WebmeshSchema.NetworkEdgeAdded.make({
          source: nodeName,
          target: targetNodeName,
        })
        yield* sendPacket(edgeAddedPacket).pipe(Effect.orDie)
      }).pipe(
        Effect.withSpan(`addEdge:${nodeName}→${targetNodeName}`, {
          attributes: { supportsTransferables: edgeChannel.supportsTransferables },
        }),
      ) as any // any-cast needed for error/never overload

    const removeEdge: MeshNode['removeEdge'] = (targetNodeName) =>
      Effect.gen(function* () {
        if (!edgeChannels.has(targetNodeName)) {
          yield* new Cause.NoSuchElementException(`No edge found for ${targetNodeName}`)
        }

        yield* Fiber.interrupt(edgeChannels.get(targetNodeName)!.listenFiber)

        edgeChannels.delete(targetNodeName)
      })

    // TODO add heartbeat to detect dead edges (for both e2e and proxying)
    // TODO when a channel is established in the same origin, we can use a weblock to detect disconnects
    const makeChannel: MeshNode['makeChannel'] = ({
      target,
      channelName,
      schema: inputSchema,
      // TODO in the future we could have a mode that prefers messagechannels and then falls back to proxies if needed
      mode,
      timeout = Duration.seconds(1),
    }) =>
      Effect.gen(function* () {
        const schema = WebChannel.mapSchema(inputSchema)
        const channelKey = `target:${target}, channelName:${channelName}` satisfies ChannelKey

        if (channelMap.has(channelKey)) {
          const existingChannel = channelMap.get(channelKey)!.debugInfo?.channel
          if (existingChannel) {
            shouldNeverHappen(`Channel ${channelKey} already exists`, existingChannel)
          }
        } else {
          const queue = yield* Queue.unbounded<MessageQueueItem | ProxyQueueItem>().pipe(
            Effect.acquireRelease(Queue.shutdown),
          )
          channelMap.set(channelKey, { queue, debugInfo: undefined })
        }

        const queue = channelMap.get(channelKey)!.queue as Queue.Queue<any>

        yield* Effect.addFinalizer(() => Effect.sync(() => channelMap.delete(channelKey)))

        if (mode === 'messagechannel') {
          const incomingPacketsQueue = yield* Queue.unbounded<any>().pipe(Effect.acquireRelease(Queue.shutdown))

          // We're we're draining the queue into another new queue.
          // It's a bit of a mystery why this is needed, since the unit tests also work without it.
          // But for the LiveStore devtools to actually work, we need to do this.
          // We should figure out some day why this is needed and further simplify if possible.
          yield* Queue.takeBetween(queue, 1, 10).pipe(
            Effect.tap((_) => Queue.offerAll(incomingPacketsQueue, _)),
            Effect.forever,
            Effect.tapCauseLogPretty,
            Effect.forkScoped,
          )

          // NOTE already retries internally when transferables are required
          const { webChannel, initialEdgeDeferred } = yield* makeMessageChannel({
            nodeName,
            incomingPacketsQueue,
            newEdgeAvailablePubSub,
            target,
            channelName,
            schema,
            sendPacket,
            checkTransferableEdges,
          })

          channelMap.set(channelKey, { queue, debugInfo: { channel: webChannel, target } })

          yield* initialEdgeDeferred

          return webChannel
        } else {
          const channel = yield* makeProxyChannel({
            nodeName,
            newEdgeAvailablePubSub,
            target,
            channelName,
            schema,
            queue,
            sendPacket,
          })

          channelMap.set(channelKey, { queue, debugInfo: { channel, target } })

          return channel
        }
      }).pipe(
        // Effect.timeout(timeout),
        Effect.withSpanScoped(`makeChannel:${nodeName}→${target}(${channelName})`, {
          attributes: { target, channelName, mode, timeout },
        }),
        Effect.annotateLogs({ nodeName }),
      )

    const makeBroadcastChannel: MeshNode['makeBroadcastChannel'] = ({ channelName, schema }) =>
      Effect.scopeWithCloseable((scope) =>
        Effect.gen(function* () {
          if (broadcastChannelListenQueueMap.has(channelName)) {
            return shouldNeverHappen(
              `Broadcast channel ${channelName} already exists`,
              broadcastChannelListenQueueMap.get(channelName),
            )
          }

          const debugInfo = {}

          const queue = yield* Queue.unbounded<any>().pipe(Effect.acquireRelease(Queue.shutdown))
          broadcastChannelListenQueueMap.set(channelName, queue)

          const send = (message: any) =>
            Effect.gen(function* () {
              const payload = yield* Schema.encode(schema)(message)
              const packet = WebmeshSchema.BroadcastChannelPacket.make({
                channelName,
                payload,
                source: nodeName,
                target: '-',
                hops: [],
              })

              yield* sendPacket(packet)
            })

          const listen = Stream.fromQueue(queue).pipe(
            Stream.filter(Schema.is(WebmeshSchema.BroadcastChannelPacket)),
            Stream.map((_) => Schema.decodeEither(schema)(_.payload)),
          )

          const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

          return {
            [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
            send,
            listen,
            closedDeferred,
            supportsTransferables: true,
            schema: { listen: schema, send: schema },
            shutdown: Scope.close(scope, Exit.void),
            debugInfo,
          } satisfies WebChannel.WebChannel<any, any>
        }),
      )

    const edgeKeys: MeshNode['edgeKeys'] = Effect.sync(() => new Set(edgeChannels.keys()))

    const runtime = yield* Effect.runtime()

    const debug: MeshNode['debug'] = {
      print: () => {
        console.log('Webmesh debug info for node:', nodeName)

        console.log('Edges:', edgeChannels.size)
        for (const [key, value] of edgeChannels) {
          console.log(`  ${key}: supportsTransferables=${value.channel.supportsTransferables}`)
        }

        console.log('Channels:', channelMap.size)
        for (const [key, value] of channelMap) {
          console.log(
            indent(key, 2),
            '\n',
            Object.entries({
              target: value.debugInfo?.target,
              supportsTransferables: value.debugInfo?.channel.supportsTransferables,
              ...value.debugInfo?.channel.debugInfo,
            })
              .map(([key, value]) => indent(`${key}=${value}`, 4))
              .join('\n'),
            '    ',
            value.debugInfo?.channel,
            '\n',
            indent(`Queue: ${value.queue.unsafeSize().pipe(Option.getOrUndefined)}`, 4),
            value.queue,
          )
        }

        console.log('Broadcast channels:', broadcastChannelListenQueueMap.size)
        for (const [key, _value] of broadcastChannelListenQueueMap) {
          console.log(indent(key, 2))
        }
      },
      ping: (payload) => {
        Effect.gen(function* () {
          const msg = (via: string) =>
            WebChannel.DebugPingMessage.make({ message: `ping from ${nodeName} via edge ${via}`, payload })

          for (const [channelName, con] of edgeChannels) {
            yield* Effect.logDebug(`sending ping via edge ${channelName}`)
            yield* con.channel.send(msg(`edge ${channelName}`) as any)
          }

          for (const [channelKey, channel] of channelMap) {
            if (channel.debugInfo === undefined) continue
            yield* Effect.logDebug(`sending ping via channel ${channelKey}`)
            yield* channel.debugInfo.channel.send(msg(`channel ${channelKey}`) as any)
          }
        }).pipe(Effect.provide(runtime), Effect.tapCauseLogPretty, Effect.runFork)
      },
      requestTopology: (timeoutMs = 1000) =>
        Effect.gen(function* () {
          const packet = WebmeshSchema.NetworkTopologyRequest.make({
            source: nodeName,
            target: '-',
            hops: [],
          })

          const item = new Map<MeshNodeName, Set<MeshNodeName>>()
          item.set(nodeName, new Set(edgeChannels.keys()))
          topologyRequestsMap.set(packet.id, item)

          yield* sendPacket(packet)

          yield* Effect.logDebug(`Waiting ${timeoutMs}ms for topology response`)
          yield* Effect.sleep(timeoutMs)

          for (const [key, value] of item) {
            yield* Effect.logDebug(`node '${key}' is connected to: ${Array.from(value.values()).join(', ')}`)
          }
        }).pipe(Effect.provide(runtime), Effect.tapCauseLogPretty, Effect.runPromise),
    }

    return {
      nodeName,
      addEdge,
      removeEdge,
      makeChannel,
      makeBroadcastChannel,
      edgeKeys,
      debug,
    } satisfies MeshNode
  }).pipe(Effect.withSpan(`makeMeshNode:${nodeName}`))
