import {
  Cause,
  Deferred,
  Effect,
  Either,
  Exit,
  Queue,
  Schema,
  Scope,
  Stream,
  TQueue,
  WebChannel,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { WebmeshSchema } from '../mod.js'
import type { MakeMessageChannelArgs } from './message-channel-internal.js'
import { makeMessageChannelInternal } from './message-channel-internal.js'

/**
 * Behaviour:
 * - Waits until there is an initial connection
 * - Automatically reconnects on disconnect
 *
 * Implementation notes:
 * - We've split up the functionality into a wrapper channel and an internal channel.
 * - The wrapper channel is responsible for:
 *   - Forwarding send/listen messages to the internal channel (via a queue)
 *   - Establishing the initial channel and reconnecting on disconnect
 *     - Listening for new connections as a hint to reconnect if not already connected
 *     - The wrapper channel maintains a connection counter which is used as the channel version
 *
 * If needed we can also implement further functionality (like heartbeat) in this wrapper channel.
 */
export const makeMessageChannel = ({
  schema,
  newConnectionAvailablePubSub,
  channelName,
  checkTransferableConnections,
  nodeName,
  incomingPacketsQueue,
  target,
  sendPacket,
}: MakeMessageChannelArgs) =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      /** Only used to identify whether a source is the same instance to know when to reconnect */
      const sourceId = nanoid()

      const listenQueue = yield* Queue.unbounded<any>()
      const sendQueue = yield* TQueue.unbounded<[msg: any, deferred: Deferred.Deferred<void>]>()

      const initialConnectionDeferred = yield* Deferred.make<void>()

      const debugInfo = {
        pendingSends: 0,
        totalSends: 0,
        connectCounter: 1,
      }

      // #region reconnect-loop
      yield* Effect.gen(function* () {
        const resultDeferred = yield* Deferred.make<{
          channel: WebChannel.WebChannel<any, any>
          channelVersion: number
          makeMessageChannelScope: Scope.CloseableScope
        }>()

        while (true) {
          debugInfo.connectCounter++
          const channelVersion = debugInfo.connectCounter

          yield* Effect.spanEvent(`Connecting#${channelVersion}`)

          const makeMessageChannelScope = yield* Scope.make()
          // Attach the new scope to the parent scope
          yield* Effect.addFinalizer((ex) => Scope.close(makeMessageChannelScope, ex))

          /**
           * Expected concurrency behaviour:
           * - We're concurrently running the connection setup and the waitForNewConnectionFiber
           * - Happy path:
           *   - The connection setup succeeds and we can interrupt the waitForNewConnectionFiber
           * - Tricky paths:
           *   - While a connection is still being setup, we want to re-try when there is a new connection
           *   - If the connection setup returns a `MessageChannelResponseNoTransferables` error,
           *     we want to wait for a new connection and then re-try
           * - Further notes:
           *   - If the parent scope closes, we want to also interrupt both the connection setup and the waitForNewConnectionFiber
           *   - We're creating a separate scope for each connection attempt, which
           *     - we'll use to fork the message channel in which allows us to interrupt it later
           *   - We need to make sure that "interruption" isn't "bubbling out"
           */
          const waitForNewConnectionFiber = yield* Stream.fromPubSub(newConnectionAvailablePubSub).pipe(
            Stream.tap((connectionName) => Effect.spanEvent(`new-conn:${connectionName}`)),
            Stream.take(1),
            Stream.runDrain,
            Effect.as('new-connection' as const),
            Effect.fork,
          )

          const makeChannel = makeMessageChannelInternal({
            nodeName,
            sourceId,
            incomingPacketsQueue,
            target,
            checkTransferableConnections,
            channelName,
            schema,
            channelVersion,
            newConnectionAvailablePubSub,
            sendPacket,
            scope: makeMessageChannelScope,
          }).pipe(Scope.extend(makeMessageChannelScope), Effect.forkIn(makeMessageChannelScope))

          const res = yield* Effect.raceFirst(makeChannel, waitForNewConnectionFiber.pipe(Effect.disconnect))

          if (res === 'new-connection') {
            yield* Scope.close(makeMessageChannelScope, Exit.fail('new-connection'))
            // We'll try again
          } else {
            const result = yield* res.pipe(Effect.exit)
            if (result._tag === 'Failure') {
              yield* Scope.close(makeMessageChannelScope, result)

              if (
                Cause.isFailType(result.cause) &&
                Schema.is(WebmeshSchema.MessageChannelResponseNoTransferables)(result.cause.error)
              ) {
                yield* waitForNewConnectionFiber.pipe(Effect.exit)
              }
            } else {
              const channel = result.value

              yield* Deferred.succeed(resultDeferred, { channel, makeMessageChannelScope, channelVersion })
              break
            }
          }
        }

        // Now we wait until the first channel is established
        const { channel, makeMessageChannelScope, channelVersion } = yield* resultDeferred

        yield* Effect.spanEvent(`Connected#${channelVersion}`)

        yield* Deferred.succeed(initialConnectionDeferred, void 0)

        // We'll now forward all incoming messages to the listen queue
        yield* channel.listen.pipe(
          Stream.flatten(),
          // Stream.tap((msg) => Effect.log(`${target}→${channelName}→${nodeName}:message:${msg.message}`)),
          Stream.tapChunk((chunk) => Queue.offerAll(listenQueue, chunk)),
          Stream.runDrain,
          Effect.tapCauseLogPretty,
          Effect.forkIn(makeMessageChannelScope),
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
        }).pipe(Effect.forkIn(makeMessageChannelScope))

        // Wait until the channel is closed and then try to reconnect
        yield* channel.closedDeferred

        yield* Scope.close(makeMessageChannelScope, Exit.succeed('channel-closed'))

        yield* Effect.spanEvent(`Disconnected#${channelVersion}`)
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

      yield* initialConnectionDeferred

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

      return webChannel as WebChannel.WebChannel<any, any>
    }),
  )
