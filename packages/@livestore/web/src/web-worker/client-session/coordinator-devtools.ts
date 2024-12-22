import type { Coordinator, UnexpectedError } from '@livestore/common'
import { Devtools } from '@livestore/common'
import { ShutdownChannel } from '@livestore/common/leader-thread'
import { isDevEnv } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, FiberHandle, Runtime, Schema, Stream, WebChannel } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { makeShutdownChannel } from '../common/shutdown-channel.js'

export const bootDevtools = ({
  coordinator,
  storeId,
  waitForDevtoolsWebBridgePort,
  connectToDevtools,
}: {
  coordinator: Coordinator
  storeId: string
  waitForDevtoolsWebBridgePort: (_: { webBridgeId: string }) => Effect.Effect<MessagePort, UnexpectedError>
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
    const webBridgeFiberHandle = yield* FiberHandle.make()

    // NOTE we're not using the existing coordinator `shutdownChannel` as we won't be able to listen to messages emitted by the same coordinator
    const shutdownChannel = yield* makeShutdownChannel(storeId)

    const connectWebBridge = FiberHandle.run(
      webBridgeFiberHandle,
      listenToWebBridge({ coordinator, waitForDevtoolsWebBridgePort, connectToDevtools, storeId }),
    )

    yield* connectWebBridge

    // TODO Given we're listening to our own messages and given the leader will emit an initial
    // `DedicatedWorkerDisconnectBroadcast`, this will re-run and we should avoid it
    yield* shutdownChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(ShutdownChannel.DedicatedWorkerDisconnectBroadcast)),
      Stream.tap(() => connectWebBridge),
      Stream.runDrain,
      Effect.ignoreLogged,
      Effect.forkScoped,
    )

    yield* listenToBrowserExtensionBridge({ coordinator, connectToDevtools })

    if (isDevEnv()) {
      yield* Effect.log(
        `[@livestore/web] Devtools ready on port ${location.origin}/_devtools.html?appHostId=${coordinator.devtools.appHostId}`,
      )
    }
  })

const listenToWebBridge = ({
  coordinator,
  storeId,
  waitForDevtoolsWebBridgePort,
  connectToDevtools,
}: {
  coordinator: Coordinator
  storeId: string
  waitForDevtoolsWebBridgePort: (_: { webBridgeId: string }) => Effect.Effect<MessagePort, UnexpectedError>
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
    const appHostId = coordinator.devtools.appHostId
    const webBridgeBroadcastChannel = yield* Devtools.WebBridge.makeBroadcastChannel()

    const isLeader = yield* coordinator.lockStatus.get.pipe(Effect.map((_) => _ === 'has-lock'))
    yield* webBridgeBroadcastChannel.send(Devtools.WebBridge.AppHostReady.make({ appHostId, isLeader }))

    const runtime = yield* Effect.runtime()

    window.addEventListener('beforeunload', () =>
      webBridgeBroadcastChannel
        .send(Devtools.WebBridge.AppHostWillDisconnect.make({ appHostId }))
        .pipe(Runtime.runFork(runtime)),
    )

    yield* Effect.addFinalizer(() =>
      webBridgeBroadcastChannel
        .send(Devtools.WebBridge.AppHostWillDisconnect.make({ appHostId }))
        .pipe(Effect.ignoreLogged),
    )

    yield* webBridgeBroadcastChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(Devtools.WebBridge.DevtoolsReady)),
      Stream.tap(({ devtoolsId }) =>
        Effect.gen(function* () {
          const webBridgeId = nanoid()
          yield* waitForDevtoolsWebBridgePort({ webBridgeId }).pipe(
            Effect.andThen(connectToDevtools),
            Effect.tapCauseLogPretty,
            Effect.forkScoped,
          )

          const isLeader = yield* coordinator.lockStatus.get.pipe(Effect.map((_) => _ === 'has-lock'))
          yield* webBridgeBroadcastChannel.send(
            Devtools.WebBridge.ConnectToDevtools.make({ appHostId, isLeader, devtoolsId, webBridgeId, storeId }),
          )
        }),
      ),
      Stream.runDrain,
      Effect.ignoreLogged,
      Effect.forkScoped,
    )

    yield* Effect.never
  }).pipe(Effect.scoped)

const listenToBrowserExtensionBridge = ({
  coordinator,
  connectToDevtools,
}: {
  coordinator: Coordinator
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
    const appHostId = coordinator.devtools.appHostId

    const windowChannel = yield* WebChannel.windowChannel({
      window,
      schema: {
        listen: Devtools.DevtoolsWindowMessage.MessageForStore,
        send: Devtools.DevtoolsWindowMessage.MessageForContentscript,
      },
    })

    yield* windowChannel.send(Devtools.DevtoolsWindowMessage.LoadIframe.make({}))

    yield* windowChannel.listen.pipe(
      Stream.flatten(),
      Stream.tap((message) =>
        Effect.gen(function* () {
          if (message._tag === 'LSD.WindowMessage.ContentscriptListening') {
            // Send message to contentscript via window (which the contentscript iframe is listening to)
            yield* windowChannel.send(Devtools.DevtoolsWindowMessage.StoreReady.make({ appHostId }))
            return
          }

          if (message.appHostId !== appHostId) return

          if (message._tag === 'LSD.WindowMessage.MessagePortReady') {
            yield* connectToDevtools(message.port)
          }
        }).pipe(Effect.ignoreLogged, Effect.forkScoped),
      ),
      Stream.runDrain,
      Effect.ignoreLogged,
      Effect.forkScoped,
    )

    yield* windowChannel.send(Devtools.DevtoolsWindowMessage.StoreReady.make({ appHostId }))
  })
