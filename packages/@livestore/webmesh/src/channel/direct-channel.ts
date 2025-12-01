import {
  Cause,
  Deferred,
  Effect,
  Either,
  Exit,
  Option,
  Queue,
  Schema,
  Scope,
  Stream,
  TQueue,
  WebChannel,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import * as WebmeshSchema from '../mesh-schema.ts'
import type { MakeDirectChannelArgs } from './direct-channel-internal.ts'
import { makeDirectChannelInternal } from './direct-channel-internal.ts'

/**
 * Behaviour:
 * - Waits until there is an initial edge
 * - Automatically reconnects on disconnect
 *
 * Implementation notes:
 * - We've split up the functionality into a wrapper channel and an internal channel.
 * - The wrapper channel is responsible for:
 *   - Forwarding send/listen messages to the internal channel (via a queue)
 *   - Establishing the initial channel and reconnecting on disconnect
 *     - Listening for new edges as a hint to reconnect if not already connected
 *     - The wrapper channel maintains a edge counter which is used as the channel version
 *
 * If needed we can also implement further functionality (like heartbeat) in this wrapper channel.
 */
export const makeDirectChannel = ({
  schema,
  newEdgeAvailablePubSub,
  channelName,
  checkTransferableEdges,
  nodeName,
  incomingPacketsQueue,
  target,
  sendPacket,
}: MakeDirectChannelArgs) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      /** Only used to identify whether a source is the same instance to know when to reconnect */
      const sourceId = nanoid()

      const listenQueue = yield* Queue.unbounded<any>()
      const sendQueue = yield* TQueue.unbounded<[msg: any, deferred: Deferred.Deferred<void>]>()

      const initialEdgeDeferred = yield* Deferred.make<void>()

      const debugInfo = {
        pendingSends: 0,
        totalSends: 0,
        connectCounter: 0,
        isConnected: false,
        innerChannelRef: { current: undefined as WebChannel.WebChannel<any, any> | undefined },
      }

      // #region reconnect-loop
      yield* Effect.gen(function* () {
        const resultDeferred = yield* Deferred.make<{
          channel: WebChannel.WebChannel<any, any>
          channelVersion: number
          makeDirectChannelScope: Scope.CloseableScope
        }>()

        while (true) {
          debugInfo.connectCounter++
          const channelVersion = debugInfo.connectCounter

          yield* Effect.spanEvent(`Connecting#${channelVersion}`)

          const makeDirectChannelScope = yield* Scope.make()
          // Attach the new scope to the parent scope
          yield* Effect.addFinalizer((ex) => Scope.close(makeDirectChannelScope, ex))

          /**
           * Expected concurrency behaviour:
           * - We're concurrently running the edge setup and the waitForNewEdgeFiber
           * - Happy path:
           *   - The edge setup succeeds and we can interrupt the waitForNewEdgeFiber
           * - Tricky paths:
           *   - While a edge is still being setup, we want to re-try when there is a new edge
           *   - If the edge setup returns a `DirectChannelResponseNoTransferables` error,
           *     we want to wait for a new edge and then re-try
           * - Further notes:
           *   - If the parent scope closes, we want to also interrupt both the edge setup and the waitForNewEdgeFiber
           *   - We're creating a separate scope for each edge attempt, which
           *     - we'll use to fork the message channel in which allows us to interrupt it later
           *   - We need to make sure that "interruption" isn't "bubbling out"
           */
          const waitForNewEdgeFiber = yield* Stream.fromPubSub(newEdgeAvailablePubSub).pipe(
            Stream.tap((edgeName) => Effect.spanEvent(`new-conn:${edgeName}`)),
            Stream.take(1),
            Stream.runDrain,
            Effect.as('new-edge' as const),
            Effect.fork,
          )

          const makeChannel = makeDirectChannelInternal({
            nodeName,
            sourceId,
            incomingPacketsQueue,
            target,
            checkTransferableEdges,
            channelName,
            schema,
            channelVersion,
            newEdgeAvailablePubSub,
            sendPacket,
            scope: makeDirectChannelScope,
          }).pipe(
            Scope.extend(makeDirectChannelScope),
            Effect.forkIn(makeDirectChannelScope),
            // Given we only call `Effect.exit` later when joining the fiber,
            // we don't want Effect to produce a "unhandled error" log message
            Effect.withUnhandledErrorLogLevel(Option.none()),
          )

          const raceResult = yield* Effect.raceFirst(makeChannel, waitForNewEdgeFiber.pipe(Effect.disconnect))

          if (raceResult === 'new-edge') {
            yield* Scope.close(makeDirectChannelScope, Exit.fail('new-edge'))
            // We'll try again
          } else {
            const channelExit = yield* raceResult.pipe(Effect.exit)
            if (channelExit._tag === 'Failure') {
              yield* Scope.close(makeDirectChannelScope, channelExit)

              if (
                Cause.isFailType(channelExit.cause) &&
                Schema.is(WebmeshSchema.DirectChannelResponseNoTransferables)(channelExit.cause.error)
              ) {
                // Only retry when there is a new edge available
                yield* waitForNewEdgeFiber.pipe(Effect.exit)
              }
            } else {
              const channel = channelExit.value

              yield* Deferred.succeed(resultDeferred, { channel, makeDirectChannelScope, channelVersion })
              break
            }
          }
        }

        // Now we wait until the first channel is established
        const { channel, makeDirectChannelScope, channelVersion } = yield* resultDeferred

        yield* Effect.spanEvent(`Connected#${channelVersion}`)
        debugInfo.isConnected = true
        debugInfo.innerChannelRef.current = channel

        yield* Deferred.succeed(initialEdgeDeferred, void 0)

        // We'll now forward all incoming messages to the listen queue
        yield* channel.listen.pipe(
          Stream.flatten(),
          // Stream.tap((msg) => Effect.log(`${target}→${channelName}→${nodeName}:message:${msg.message}`)),
          Stream.tapChunk((chunk) => Queue.offerAll(listenQueue, chunk)),
          Stream.runDrain,
          Effect.tapCauseLogPretty,
          Effect.forkIn(makeDirectChannelScope),
        )

        yield* Effect.gen(function* () {
          while (true) {
            const [msg, deferred] = yield* TQueue.peek(sendQueue)
            // NOTE we don't need an explicit retry flow here since in case of the channel being closed,
            // the send will never succeed. Meanwhile the send-loop fiber will be interrupted and
            // given we only peeked at the queue, the message to send is still there.
            yield* channel.send(msg)
            yield* Deferred.succeed(deferred, void 0)
            yield* TQueue.take(sendQueue) // Remove the message from the queue
          }
        }).pipe(Effect.forkIn(makeDirectChannelScope))

        // Wait until the channel is closed and then try to reconnect
        yield* channel.closedDeferred

        yield* Scope.close(makeDirectChannelScope, Exit.succeed('channel-closed'))

        yield* Effect.spanEvent(`Disconnected#${channelVersion}`)
        debugInfo.isConnected = false
        debugInfo.innerChannelRef.current = undefined
      }).pipe(
        Effect.scoped, // Additionally scoping here to clean up finalizers after each loop run
        Effect.forever,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )
      // #endregion reconnect-loop

      const parentSpan = yield* Effect.currentSpan.pipe(Effect.orDie)

      const send = (message: any) =>
        Effect.gen(function* () {
          const sentDeferred = yield* Deferred.make<void>()

          debugInfo.pendingSends++
          debugInfo.totalSends++

          yield* TQueue.offer(sendQueue, [message, sentDeferred])

          yield* sentDeferred

          debugInfo.pendingSends--
        }).pipe(Effect.scoped, Effect.withParentSpan(parentSpan))

      const listen = Stream.fromQueue(listenQueue, { maxChunkSize: 1 }).pipe(Stream.map(Either.right))

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

      const webChannel = {
        [WebChannel.WebChannelSymbol]: WebChannel.WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        supportsTransferables: true,
        schema,
        debugInfo,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
      } satisfies WebChannel.WebChannel<any, any>

      return {
        webChannel: webChannel as WebChannel.WebChannel<any, any>,
        initialEdgeDeferred,
      }
    }),
  )
