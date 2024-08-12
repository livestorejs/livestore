import { Devtools, liveStoreVersion } from '@livestore/common'
import { makeExpoDevtoolsChannel } from '@livestore/devtools-expo-bridge/web-channel'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, PubSub, Schema, Stream } from '@livestore/utils/effect'

export const prepareExpoDevtoolsBridge: Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> = Effect.gen(
  function* () {
    const expoDevtoolsChannel = yield* makeExpoDevtoolsChannel({
      sendSchema: Schema.Union(Devtools.MessageToAppHostCoordinator, Devtools.MessageToAppHostStore),
      listenSchema: Schema.Union(Devtools.MessageFromAppHostCoordinator, Devtools.MessageFromAppHostStore),
    })

    const responsePubSub = yield* PubSub.unbounded<
      Devtools.MessageFromAppHostCoordinator | Devtools.MessageFromAppHostStore
    >()

    const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeaderTab: boolean }>()

    yield* expoDevtoolsChannel.listen.pipe(
      Stream.flatten(),
      // Stream.tapLogWithLabel('appHostCoordinatorChannel.listen'),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          if (msg._tag === 'LSD.AppHostReady') {
            const { appHostId, isLeaderTab } = msg
            yield* Deferred.succeed(appHostInfoDeferred, { appHostId, isLeaderTab })
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

    const { appHostId, isLeaderTab } = yield* Deferred.await(appHostInfoDeferred)

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
      isLeaderTab,
    } satisfies Devtools.PrepareDevtoolsBridge
  },
).pipe(Effect.orDie)
