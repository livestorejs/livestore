import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Cause, Duration, Effect, Fiber, PubSub, Queue, Schema, Stream, WebChannel } from '@livestore/utils/effect'

import { makeMessageChannel } from './channel/message-channel.js'
import { makeProxyChannel } from './channel/proxy-channel.js'
import type { ChannelKey, MeshNodeName, MessageQueueItem, ProxyQueueItem } from './common.js'
import { ConnectionAlreadyExistsError, packetAsOtelAttributes } from './common.js'
import * as MeshSchema from './mesh-schema.js'
import { TimeoutSet } from './utils.js'

type ConnectionChannel = WebChannel.WebChannel<typeof MeshSchema.Packet.Type, typeof MeshSchema.Packet.Type>

export interface MeshNode {
  nodeName: MeshNodeName

  connectionKeys: Effect.Effect<Set<MeshNodeName>>

  /**
   * Manually adds a connection to get connected to the network of nodes with an existing WebChannel.
   *
   * Assumptions about the WebChannel connection:
   * - 1:1 connection
   * - Queues messages internally to never drop messages
   * - Automatically reconnects
   * - Ideally supports transferables
   */
  addConnection: {
    (options: {
      target: MeshNodeName
      connectionChannel: ConnectionChannel
      replaceIfExists: true
    }): Effect.Effect<void, never, Scope.Scope>
    (options: {
      target: MeshNodeName
      connectionChannel: ConnectionChannel
      replaceIfExists?: boolean
    }): Effect.Effect<void, ConnectionAlreadyExistsError, Scope.Scope>
  }

  removeConnection: (targetNodeName: MeshNodeName) => Effect.Effect<void, Cause.NoSuchElementException>

  /**
   * Tries to broker a MessageChannel connection between the nodes, otherwise will proxy messages via hop-nodes
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
     * Amount of time before we consider a channel creation failed and retry when a new connection is available
     *
     * @default 1 second
     */
    timeout?: Duration.DurationInput
  }) => Effect.Effect<WebChannel.WebChannel<MsgListen, MsgSend>, never, Scope.Scope>
}

export const makeMeshNode = (nodeName: MeshNodeName): Effect.Effect<MeshNode, never, Scope.Scope> =>
  Effect.gen(function* () {
    const connectionChannels = new Map<
      MeshNodeName,
      { channel: ConnectionChannel; listenFiber: Fiber.RuntimeFiber<void> }
    >()

    // To avoid unbounded memory growth, we automatically forget about packet ids after a while
    const handledPacketIds = new TimeoutSet<string>({ timeout: Duration.minutes(1) })

    const newConnectionAvailablePubSub = yield* PubSub.unbounded<MeshNodeName>().pipe(
      Effect.acquireRelease(PubSub.shutdown),
    )

    // const proxyPacketsToProcess = yield* Queue.unbounded<ProxyQueueItem>().pipe(Effect.acquireRelease(Queue.shutdown))
    // const messagePacketsToProcess = yield* Queue.unbounded<MessageQueueItem>().pipe(
    //   Effect.acquireRelease(Queue.shutdown),
    // )

    const channelMap = new Map<ChannelKey, { queue: Queue.Queue<MessageQueueItem | ProxyQueueItem> }>()

    const checkTransferableConnections = (packet: typeof MeshSchema.MessageChannelPacket.Type) => {
      if (
        (packet._tag === 'MessageChannelRequest' &&
          (connectionChannels.size === 0 ||
            // Either if direct connection does not support transferables ...
            connectionChannels.get(packet.target)?.channel.supportsTransferables === false)) ||
        // ... or if no forward-connections support transferables
        ![...connectionChannels.values()].some((c) => c.channel.supportsTransferables === true)
      ) {
        return MeshSchema.MessageChannelResponseNoTransferables.make({
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

    const sendPacket = (packet: typeof MeshSchema.Packet.Type) =>
      Effect.gen(function* () {
        if (Schema.is(MeshSchema.NetworkConnectionAdded)(packet)) {
          yield* Effect.spanEvent('NetworkConnectionAdded', { packet, nodeName })
          yield* PubSub.publish(newConnectionAvailablePubSub, packet.target)

          const connectionsToForwardTo = Array.from(connectionChannels)
            .filter(([name]) => name !== packet.source)
            .map(([_, con]) => con.channel)

          yield* Effect.forEach(connectionsToForwardTo, (con) => con.send(packet), { concurrency: 'unbounded' })
          return
        }

        // We have a direct connection to the target node
        if (connectionChannels.has(packet.target)) {
          const connectionChannel = connectionChannels.get(packet.target)!.channel
          const hops = packet.source === nodeName ? [] : [...packet.hops, nodeName]
          yield* connectionChannel.send({ ...packet, hops })
        }
        // In this case we have an expected route back we should follow
        // eslint-disable-next-line unicorn/no-negated-condition
        else if (packet.remainingHops !== undefined) {
          const hopTarget =
            packet.remainingHops[0] ?? shouldNeverHappen(`${nodeName}: Expected remaining hops for packet`, packet)
          const connectionChannel = connectionChannels.get(hopTarget)?.channel

          if (connectionChannel === undefined) {
            yield* Effect.logWarning(
              `${nodeName}: Expected to find hop target ${hopTarget} in connections. Dropping packet.`,
              packet,
            )
            return
          }

          yield* connectionChannel.send({
            ...packet,
            remainingHops: packet.remainingHops.slice(1),
            hops: [...packet.hops, nodeName],
          })
        }
        // No route found, forward to all connections
        else {
          const hops = packet.source === nodeName ? [] : [...packet.hops, nodeName]

          // Optimization: filter out connection where packet just came from
          const connectionsToForwardTo = Array.from(connectionChannels)
            .filter(([name]) => name !== packet.source)
            .map(([_, con]) => con.channel)

          // TODO if hops-depth=0, we should fail right away with no route found
          if (hops.length === 0 && connectionsToForwardTo.length === 0 && LS_DEV) {
            console.log(nodeName, 'no route found', packet._tag, 'TODO handle better')
            // TODO return a expected failure
          }

          const packetToSend = { ...packet, hops }

          yield* Effect.forEach(connectionsToForwardTo, (con) => con.send(packetToSend), { concurrency: 'unbounded' })
        }
      }).pipe(
        Effect.withSpan(`sendPacket:${packet._tag}:${packet.source}→${packet.target}`, {
          attributes: packetAsOtelAttributes(packet),
        }),
        Effect.orDie,
      )

    const addConnection: MeshNode['addConnection'] = ({
      target: targetNodeName,
      connectionChannel,
      replaceIfExists = false,
    }) =>
      Effect.gen(function* () {
        if (connectionChannels.has(targetNodeName)) {
          if (replaceIfExists) {
            yield* removeConnection(targetNodeName).pipe(Effect.orDie)
            // console.log('interrupting', targetNodeName)
            // yield* Fiber.interrupt(connectionChannels.get(targetNodeName)!.listenFiber)
          } else {
            return yield* new ConnectionAlreadyExistsError({ target: targetNodeName })
          }
        }

        // TODO use a priority queue instead to prioritize network-changes/connection-requests over payloads
        const listenFiber = yield* connectionChannel.listen.pipe(
          Stream.flatten(),
          Stream.tap((message) =>
            Effect.gen(function* () {
              const packet = yield* Schema.decodeUnknown(MeshSchema.Packet)(message)

              // console.debug(nodeName, 'received', packet._tag, packet.source, packet.target)

              if (handledPacketIds.has(packet.id)) return
              handledPacketIds.add(packet.id)

              if (packet._tag === 'NetworkConnectionAdded') {
                yield* sendPacket(packet)
              } else if (packet.target === nodeName) {
                const channelKey = `${packet.source}-${packet.channelName}` satisfies ChannelKey

                if (!channelMap.has(channelKey)) {
                  const queue = yield* Queue.unbounded<MessageQueueItem | ProxyQueueItem>().pipe(
                    Effect.acquireRelease(Queue.shutdown),
                  )
                  channelMap.set(channelKey, { queue })
                }

                const queue = channelMap.get(channelKey)!.queue

                const respondToSender = (outgoingPacket: typeof MeshSchema.Packet.Type) =>
                  connectionChannel
                    .send(outgoingPacket)
                    .pipe(
                      Effect.withSpan(
                        `respondToSender:${outgoingPacket._tag}:${outgoingPacket.source}→${outgoingPacket.target}`,
                        { attributes: packetAsOtelAttributes(outgoingPacket) },
                      ),
                      Effect.orDie,
                    )

                if (Schema.is(MeshSchema.ProxyChannelPacket)(packet)) {
                  yield* Queue.offer(queue, { packet, respondToSender })
                } else if (Schema.is(MeshSchema.MessageChannelPacket)(packet)) {
                  yield* Queue.offer(queue, { packet, respondToSender })
                }
              } else {
                if (Schema.is(MeshSchema.MessageChannelPacket)(packet)) {
                  const noTransferableResponse = checkTransferableConnections(packet)
                  if (noTransferableResponse !== undefined) {
                    yield* Effect.spanEvent(`No transferable connections found for ${packet.source}→${packet.target}`)
                    return yield* connectionChannel.send(noTransferableResponse).pipe(
                      Effect.withSpan(`sendNoTransferableResponse:${packet.source}→${packet.target}`, {
                        attributes: packetAsOtelAttributes(noTransferableResponse),
                      }),
                    )
                  }
                }

                yield* sendPacket(packet)
              }
            }),
          ),
          Stream.runDrain,
          Effect.orDie,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        connectionChannels.set(targetNodeName, { channel: connectionChannel, listenFiber })

        const connectionAddedPacket = MeshSchema.NetworkConnectionAdded.make({
          source: nodeName,
          target: targetNodeName,
        })
        yield* sendPacket(connectionAddedPacket).pipe(Effect.ignoreLogged)
      }).pipe(
        Effect.withSpan(`addConnection:${nodeName}→${targetNodeName}`, {
          attributes: { supportsTransferables: connectionChannel.supportsTransferables },
        }),
      ) as any // any-cast needed for error/never overload

    const removeConnection: MeshNode['removeConnection'] = (targetNodeName) =>
      Effect.gen(function* () {
        if (!connectionChannels.has(targetNodeName)) {
          yield* new Cause.NoSuchElementException(`No connection found for ${targetNodeName}`)
        }

        yield* Fiber.interrupt(connectionChannels.get(targetNodeName)!.listenFiber)

        connectionChannels.delete(targetNodeName)
      })

    // TODO add heartbeat to detect dead connections (for both e2e and proxying)
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
        const channelKey = `${target}-${channelName}` satisfies ChannelKey

        if (!channelMap.has(channelKey)) {
          const queue = yield* Queue.unbounded<MessageQueueItem | ProxyQueueItem>().pipe(
            Effect.acquireRelease(Queue.shutdown),
          )
          channelMap.set(channelKey, { queue })
        }

        const queue = channelMap.get(channelKey)!.queue as Queue.Queue<any>

        yield* Effect.addFinalizer(() => Effect.sync(() => channelMap.delete(channelKey)))

        if (mode === 'messagechannel') {
          // console.debug(nodeName, 'message mode', modeRef.current)

          // NOTE already retries internally when transferables are required
          return yield* makeMessageChannel({
            nodeName,
            queue,
            newConnectionAvailablePubSub,
            target,
            channelName,
            schema,
            sendPacket,
            checkTransferableConnections,
          })
        } else {
          return yield* makeProxyChannel({
            nodeName,
            newConnectionAvailablePubSub,
            target,
            channelName,
            schema,
            queue,
            sendPacket,
          })
        }
      }).pipe(
        Effect.withSpanScoped(`makeChannel:${nodeName}→${target}(${channelName})`, {
          attributes: { target, channelName, mode, timeout },
        }),
        Effect.annotateLogs({ nodeName }),
      )

    const connectionKeys: MeshNode['connectionKeys'] = Effect.sync(() => new Set(connectionChannels.keys()))

    return { nodeName, addConnection, removeConnection, makeChannel, connectionKeys } satisfies MeshNode
  }).pipe(Effect.withSpan(`makeMeshNode:${nodeName}`))
