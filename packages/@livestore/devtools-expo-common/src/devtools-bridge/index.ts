import { Devtools, liveStoreVersion } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, PubSub, Schema, Stream } from '@livestore/utils/effect'

import { makeExpoDevtoolsChannel } from '../web-channel/index.js'

// TODO use a unique bridgeId for each connection (similar to web bridge)
export const prepareExpoDevtoolsBridge: Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> = Effect.gen(
  function* () {
    const expoDevtoolsChannel = yield* makeExpoDevtoolsChannel({
      sendSchema: Schema.Union(Devtools.MessageToAppHostCoordinator, Devtools.MessageToAppHostStore),
      listenSchema: Schema.Union(Devtools.MessageFromAppHostCoordinator, Devtools.MessageFromAppHostStore),
    })

    const responsePubSub = yield* PubSub.unbounded<
      Devtools.MessageFromAppHostCoordinator | Devtools.MessageFromAppHostStore
    >().pipe(Effect.acquireRelease(PubSub.shutdown))

    const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeader: boolean }>()

    yield* expoDevtoolsChannel.listen.pipe(
      Stream.flatten(),
      // Stream.tapLogWithLabel('appHostCoordinatorChannel.listen'),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          if (msg._tag === 'LSD.AppHostReady') {
            const { appHostId, isLeader } = msg
            yield* Deferred.succeed(appHostInfoDeferred, { appHostId, isLeader })
          } else {
            yield* PubSub.publish(responsePubSub, msg)
          }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('portForDevtoolsChannel.listen'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* expoDevtoolsChannel.send(Devtools.DevtoolsReady.make({ liveStoreVersion }))

    const { appHostId, isLeader } = yield* Deferred.await(appHostInfoDeferred)

    yield* Deferred.await(expoDevtoolsChannel.closedDeferred).pipe(
      Effect.tap(() => PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, appHostId }))),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const sendToAppHost: Devtools.PrepareDevtoolsBridge['sendToAppHost'] = (msg) =>
      expoDevtoolsChannel.send(msg).pipe(Effect.withSpan('sendToAppHost'), Effect.orDie)

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      responsePubSub,
      sendToAppHost,
      appHostId,
      copyToClipboard,
      isLeader,
    } satisfies Devtools.PrepareDevtoolsBridge
  },
).pipe(Effect.orDie)
