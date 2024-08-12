import type { Coordinator, UnexpectedError } from '@livestore/common'
import { Devtools } from '@livestore/common'
import { cuid } from '@livestore/utils/cuid'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Either, FiberHandle, Runtime, Schema, Stream, WebChannel } from '@livestore/utils/effect'

import { DedicatedWorkerDisconnectBroadcast, makeShutdownChannel } from './shutdown-channel.js'

export const bootDevtools = ({
  coordinator,
  waitForDevtoolsWebBridgePort,
  connectToDevtools,
  key,
}: {
  coordinator: Coordinator
  waitForDevtoolsWebBridgePort: (_: { webBridgeId: string }) => Effect.Effect<MessagePort, UnexpectedError>
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
  key: string
}) =>
  Effect.gen(function* () {
    const webBridgeFiberHandle = yield* FiberHandle.make()

    // NOTE we're not using the existing coordinator `shutdownChannel` as we won't be able to listen to messages emitted by the same coordinator
    const shutdownChannel = yield* makeShutdownChannel(key)

    const runWebBridge = FiberHandle.run(
      webBridgeFiberHandle,
      listenToWebBridge({ coordinator, waitForDevtoolsWebBridgePort, connectToDevtools }),
    )

    yield* runWebBridge

    // TODO Given we're listening to our own messages and given the leader will emit an initial
    // `DedicatedWorkerDisconnectBroadcast`, this will re-run and we should avoid it
    yield* shutdownChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(DedicatedWorkerDisconnectBroadcast)),
      Stream.tap(() => runWebBridge),
      Stream.runDrain,
      Effect.ignoreLogged,
      Effect.forkScoped,
    )

    yield* listenToBrowserExtensionBridge({ coordinator, connectToDevtools })
  })

const listenToWebBridge = ({
  coordinator,
  waitForDevtoolsWebBridgePort,
  connectToDevtools,
}: {
  coordinator: Coordinator
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
          const webBridgeId = cuid()
          yield* waitForDevtoolsWebBridgePort({ webBridgeId }).pipe(
            Effect.andThen(connectToDevtools),
            Effect.tapCauseLogPretty,
            Effect.forkScoped,
          )

          const isLeader = yield* coordinator.lockStatus.get.pipe(Effect.map((_) => _ === 'has-lock'))
          yield* webBridgeBroadcastChannel.send(
            Devtools.WebBridge.ConnectToDevtools.make({ appHostId, isLeader, devtoolsId, webBridgeId }),
          )
        }),
      ),
      Stream.runDrain,
      Effect.ignoreLogged,
      Effect.forkScoped,
    )

    yield* Effect.never
  }).pipe(Effect.scoped)

export const listenToBrowserExtensionBridge = ({
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
      listenSchema: Devtools.DevtoolsWindowMessage.MessageForStore,
      sendSchema: Devtools.DevtoolsWindowMessage.MessageForContentscript,
    })

    yield* windowChannel.send(Devtools.DevtoolsWindowMessage.LoadIframe.make({}))

    yield* windowChannel.listen.pipe(
      Stream.filterMap(Either.getRight),
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
