import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import type { PubSub } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  Exit,
  OtelTracer,
  Predicate,
  Queue,
  Schema,
  Scope,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'

import { type ChannelName, type MeshNodeName, type MessageQueueItem, packetAsOtelAttributes } from '../common.js'
import * as MeshSchema from '../mesh-schema.js'

export interface MakeMessageChannelArgs {
  nodeName: MeshNodeName
  /** Queue of incoming messages for this channel */
  incomingPacketsQueue: Queue.Queue<MessageQueueItem>
  newConnectionAvailablePubSub: PubSub.PubSub<MeshNodeName>
  channelName: ChannelName
  target: MeshNodeName
  sendPacket: (packet: typeof MeshSchema.MessageChannelPacket.Type) => Effect.Effect<void>
  checkTransferableConnections: (
    packet: typeof MeshSchema.MessageChannelPacket.Type,
  ) => typeof MeshSchema.MessageChannelResponseNoTransferables.Type | undefined
  schema: WebChannel.OutputSchema<any, any, any, any>
}

const makeDeferredResult = Deferred.make<
  WebChannel.WebChannel<any, any>,
  typeof MeshSchema.MessageChannelResponseNoTransferables.Type
>

/**
 * The channel version is important here, as a channel will only be established once both sides have the same version.
 * The version is used to avoid concurrency issues where both sides have different incompatible message ports.
 */
export const makeMessageChannelInternal = ({
  nodeName,
  incomingPacketsQueue,
  target,
  checkTransferableConnections,
  channelName,
  schema: schema_,
  sendPacket,
  channelVersion,
  scope,
  sourceId,
}: MakeMessageChannelArgs & {
  channelVersion: number
  /** We're passing in the closeable scope from the wrapping message channel */
  scope: Scope.CloseableScope
  sourceId: string
}): Effect.Effect<
  WebChannel.WebChannel<any, any>,
  typeof MeshSchema.MessageChannelResponseNoTransferables.Type,
  Scope.Scope
> =>
  Effect.gen(function* () {
    // yield* Effect.addFinalizer((exit) =>
    //   Effect.spanEvent(`shutdown:${exit._tag === 'Success' ? 'Success' : Cause.pretty(exit.cause)}`),
    // )

    type ChannelState =
      | {
          _tag: 'Initial'
        }
      | {
          _tag: 'RequestSent'
          reqPacketId: string
        }
      | {
          _tag: 'winner:ResponseSent'
          channel: WebChannel.WebChannel<any, any>
          otherSourceId: string
        }
      | {
          _tag: 'loser:WaitingForResponse'
          otherSourceId: string
        }
      | {
          _tag: 'Established'
          otherSourceId: string
        }

    const deferred = yield* makeDeferredResult()

    const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    // const span = {
    //   addEvent: (...msg: any[]) => console.log(`${nodeName}→${channelName}→${target}[${channelVersion}]`, ...msg),
    // }

    const schema = {
      send: Schema.Union(schema_.send, MeshSchema.MessageChannelPing, MeshSchema.MessageChannelPong),
      listen: Schema.Union(schema_.listen, MeshSchema.MessageChannelPing, MeshSchema.MessageChannelPong),
    }

    const channelStateRef: { current: ChannelState } = {
      current: { _tag: 'Initial' },
    }

    const processMessagePacket = ({ packet, respondToSender }: MessageQueueItem) =>
      Effect.gen(function* () {
        const channelState = channelStateRef.current

        span?.addEvent(`process:${packet._tag}`, {
          channelState: channelState._tag,
          packetId: packet.id,
          packetReqId: packet.reqId,
          packetChannelVersion: Predicate.hasProperty('channelVersion')(packet) ? packet.channelVersion : undefined,
        })

        // const reqIdStr =
        //   Predicate.hasProperty('reqId')(packet) && packet.reqId !== undefined ? ` for ${packet.reqId}` : ''
        // yield* Effect.log(
        //   `${nodeName}→${channelName}→${target}[${channelVersion}]:process packet ${packet._tag} [${packet.id}${reqIdStr}], channel state: ${channelState._tag}`,
        // )

        if (channelState._tag === 'Initial') return shouldNeverHappen()

        if (packet._tag === 'MessageChannelResponseNoTransferables') {
          yield* Deferred.fail(deferred, packet)
          return 'close'
        }

        // If the other side has a higher version, we need to close this channel and
        // recreate it with the new version
        if (packet.channelVersion > channelVersion) {
          span?.addEvent(`incoming packet has higher version (${packet.channelVersion}), closing channel`)
          yield* Scope.close(scope, Exit.succeed('higher-version-expected'))
          // TODO include expected version in the error so the channel gets recreated with the new version
          return 'close'
        }

        // If this channel has a higher version, we need to signal the other side to close
        // and recreate the channel with the new version
        if (packet.channelVersion < channelVersion) {
          const newPacket = MeshSchema.MessageChannelRequest.make({
            source: nodeName,
            sourceId,
            target,
            channelName,
            channelVersion,
            hops: [],
            remainingHops: packet.hops,
            reqId: undefined,
          })
          span?.addEvent(
            `incoming packet has lower version (${packet.channelVersion}), sending request to reconnect (${newPacket.id})`,
          )

          yield* sendPacket(newPacket)

          return
        }

        if (channelState._tag === 'Established' && packet._tag === 'MessageChannelRequest') {
          if (packet.sourceId === channelState.otherSourceId) {
            return
          } else {
            // In case the instance of the source has changed, we need to close the channel
            // and reconnect with a new channel
            span?.addEvent(`force-new-channel`)
            yield* Scope.close(scope, Exit.succeed('force-new-channel'))
            return 'close'
          }
        }

        switch (packet._tag) {
          // Assumption: Each side has sent an initial request and another request as a response for an incoming request
          case 'MessageChannelRequest': {
            if (channelState._tag !== 'RequestSent') {
              // We can safely ignore further incoming requests as we're already creating a channel
              return
            }

            if (packet.reqId === channelState.reqPacketId) {
              // Circuit-breaker: We've already sent a request so we don't need to send another one
            } else {
              const newRequestPacket = MeshSchema.MessageChannelRequest.make({
                source: nodeName,
                sourceId,
                target,
                channelName,
                channelVersion,
                hops: [],
                remainingHops: packet.hops,
                reqId: packet.id,
              })
              span?.addEvent(`Re-sending new request (${newRequestPacket.id}) for incoming request (${packet.id})`)

              yield* sendPacket(newRequestPacket)
            }

            const isWinner = nodeName > target

            if (isWinner) {
              span?.addEvent(`winner side: creating message channel and sending response`)
              const mc = new MessageChannel()

              // We're using a message channel with acks here to make sure messages are not lost
              // which might happen during re-connection scenarios.
              // Also we need to eagerly start listening since we're using the channel "ourselves"
              // for the initial ping-pong sequence.
              const channel = yield* WebChannel.messagePortChannelWithAck({
                port: mc.port1,
                schema,
                debugId: channelVersion,
              }).pipe(Effect.andThen(WebChannel.toOpenChannel))

              yield* respondToSender(
                MeshSchema.MessageChannelResponseSuccess.make({
                  reqId: packet.id,
                  target,
                  source: nodeName,
                  channelName: packet.channelName,
                  hops: [],
                  remainingHops: packet.hops,
                  port: mc.port2,
                  channelVersion,
                }),
              )

              channelStateRef.current = { _tag: 'winner:ResponseSent', channel, otherSourceId: packet.sourceId }

              // span?.addEvent(`winner side: waiting for ping`)

              // Now we wait for the other side to respond via the channel
              yield* channel.listen.pipe(
                Stream.flatten(),
                Stream.filter(Schema.is(MeshSchema.MessageChannelPing)),
                Stream.take(1),
                Stream.runDrain,
              )

              // span?.addEvent(`winner side: sending pong`)

              yield* channel.send(MeshSchema.MessageChannelPong.make({}))

              span?.addEvent(`winner side: established`)
              channelStateRef.current = { _tag: 'Established', otherSourceId: packet.sourceId }

              yield* Deferred.succeed(deferred, channel)
            } else {
              span?.addEvent(`loser side: waiting for response`)
              // Wait for `MessageChannelResponseSuccess` packet
              channelStateRef.current = { _tag: 'loser:WaitingForResponse', otherSourceId: packet.sourceId }
            }

            break
          }
          case 'MessageChannelResponseSuccess': {
            if (channelState._tag !== 'loser:WaitingForResponse') {
              return shouldNeverHappen(
                `Expected to find message channel response from ${target}, but was in ${channelState._tag} state`,
              )
            }

            // See message-channel notes above
            const channel = yield* WebChannel.messagePortChannelWithAck({
              port: packet.port,
              schema,
              debugId: channelVersion,
            }).pipe(Effect.andThen(WebChannel.toOpenChannel))

            const waitForPongFiber = yield* channel.listen.pipe(
              Stream.flatten(),
              Stream.filter(Schema.is(MeshSchema.MessageChannelPong)),
              Stream.take(1),
              Stream.runDrain,
              Effect.fork,
            )

            // span?.addEvent(`loser side: sending ping`)

            // There seems to be some scenario where the initial ping message is lost.
            // As a workaround until we find the root cause, we're retrying the ping a few times.
            // TODO write a test that reproduces this issue and fix the root cause
            yield* channel
              .send(MeshSchema.MessageChannelPing.make({}))
              .pipe(Effect.timeout(10), Effect.retry({ times: 2 }))

            // span?.addEvent(`loser side: waiting for pong`)

            yield* waitForPongFiber

            span?.addEvent(`loser side: established`)
            channelStateRef.current = { _tag: 'Established', otherSourceId: channelState.otherSourceId }

            yield* Deferred.succeed(deferred, channel)

            return
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

    yield* Effect.gen(function* () {
      while (true) {
        const packet = yield* Queue.take(incomingPacketsQueue)
        const res = yield* processMessagePacket(packet)
        // We want to give requests another chance to be processed
        if (res === 'close') {
          return
        }
      }
    }).pipe(Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)

    const channelState = channelStateRef.current

    if (channelState._tag !== 'Initial') {
      return shouldNeverHappen(`Expected channel to be in Initial state, but was in ${channelState._tag} state`)
    }

    const connectionRequest = Effect.gen(function* () {
      const packet = MeshSchema.MessageChannelRequest.make({
        source: nodeName,
        sourceId,
        target,
        channelName,
        channelVersion,
        hops: [],
        reqId: undefined,
      })

      channelStateRef.current = { _tag: 'RequestSent', reqPacketId: packet.id }

      // yield* Effect.log(`${nodeName}→${channelName}→${target}:connectionRequest [${channelVersion}]`)

      const noTransferableResponse = checkTransferableConnections(packet)
      if (noTransferableResponse !== undefined) {
        yield* Effect.spanEvent(`No transferable connections found for ${packet.source}→${packet.target}`)
        return yield* Effect.fail(noTransferableResponse)
      }

      yield* sendPacket(packet)
      span?.addEvent(`initial connection request sent (${packet.id})`)
    })

    yield* connectionRequest

    const channel = yield* deferred

    return channel
  }).pipe(Effect.withSpanScoped(`makeMessageChannel:${channelVersion}`))
