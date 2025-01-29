import type { ClientSession, UnexpectedError } from '@livestore/common'
import { Devtools } from '@livestore/common'
import { ShutdownChannel } from '@livestore/common/leader-thread'
import { isDevEnv } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, FiberHandle, Runtime, Schema, Stream, WebChannel } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { makeShutdownChannel } from '../common/shutdown-channel.js'

export const bootDevtools = ({
  clientSession,
  storeId,
  // waitForDevtoolsWebBridgePort,
  // connectToDevtools,
}: {
  clientSession: ClientSession
  storeId: string
  // waitForDevtoolsWebBridgePort: (_: { webBridgeId: string }) => Effect.Effect<MessagePort, UnexpectedError>
  // connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
    // const webBridgeFiberHandle = yield* FiberHandle.make()

    // // NOTE we're not using the existing coordinator `shutdownChannel` as we won't be able to listen to messages emitted by the same coordinator
    // const shutdownChannel = yield* makeShutdownChannel(storeId)

    // const connectWebBridge = FiberHandle.run(
    //   webBridgeFiberHandle,
    //   listenToWebBridge({ coordinator, waitForDevtoolsWebBridgePort, connectToDevtools, storeId }),
    // )

    // yield* connectWebBridge

    // // TODO Given we're listening to our own messages and given the leader will emit an initial
    // // `DedicatedWorkerDisconnectBroadcast`, this will re-run and we should avoid it
    // yield* shutdownChannel.listen.pipe(
    //   Stream.flatten(),
    //   Stream.filter(Schema.is(ShutdownChannel.DedicatedWorkerDisconnectBroadcast)),
    //   Stream.tap(() => connectWebBridge),
    //   Stream.runDrain,
    //   Effect.ignoreLogged,
    //   Effect.forkScoped,
    // )

    // yield* listenToBrowserExtensionBridge({ coordinator, connectToDevtools })

    if (isDevEnv()) {
      const searchParams = new URLSearchParams()
      searchParams.set('clientId', clientSession.clientId)
      searchParams.set('sessionId', clientSession.sessionId)
      searchParams.set('storeId', storeId)
      const url = `${location.origin}/_devtools.html?${searchParams.toString()}`

      // Check whether devtools are available and then log the URL
      const response = yield* Effect.promise(() => fetch(url))
      if (response.ok) {
        const text = yield* Effect.promise(() => response.text())
        if (text.includes('<meta name="livestore-devtools" content="true" />')) {
          yield* Effect.log(`[@livestore/web] Devtools ready on ${url}`)
        }
      }
    }
  }).pipe(Effect.withSpan('@livestore/web:coordinator:devtools:boot'))

const listenToWebBridge = ({
  clientSession,
  storeId,
  waitForDevtoolsWebBridgePort,
  connectToDevtools,
}: {
  clientSession: ClientSession
  storeId: string
  waitForDevtoolsWebBridgePort: (_: { webBridgeId: string }) => Effect.Effect<MessagePort, UnexpectedError>
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
    // const appHostId = clientSession.devtools.appHostId
    const webBridgeBroadcastChannel = yield* Devtools.WebBridge.makeBroadcastChannel()

    // const isLeader = yield* clientSession.lockStatus.get.pipe(Effect.map((_) => _ === 'has-lock'))
    // yield* webBridgeBroadcastChannel.send(Devtools.WebBridge.AppHostReady.make({ appHostId, isLeader }))

    const runtime = yield* Effect.runtime()

    // window.addEventListener('beforeunload', () =>
    //   webBridgeBroadcastChannel
    //     .send(Devtools.WebBridge.AppHostWillDisconnect.make({ appHostId }))
    //     .pipe(Runtime.runFork(runtime)),
    // )

    // yield* Effect.addFinalizer(() =>
    //   webBridgeBroadcastChannel
    //     .send(Devtools.WebBridge.AppHostWillDisconnect.make({ appHostId }))
    //     .pipe(Effect.ignoreLogged),
    // )

    // yield* webBridgeBroadcastChannel.listen.pipe(
    //   Stream.flatten(),
    //   Stream.filter(Schema.is(Devtools.WebBridge.DevtoolsReady)),
    //   Stream.tap(({ devtoolsId }) =>
    //     Effect.gen(function* () {
    //       const webBridgeId = nanoid()
    //       yield* waitForDevtoolsWebBridgePort({ webBridgeId }).pipe(
    //         Effect.andThen(connectToDevtools),
    //         Effect.tapCauseLogPretty,
    //         Effect.forkScoped,
    //       )

    //       const isLeader = yield* clientSession.lockStatus.get.pipe(Effect.map((_) => _ === 'has-lock'))
    //       yield* webBridgeBroadcastChannel.send(
    //         Devtools.WebBridge.ConnectToDevtools.make({ appHostId, isLeader, devtoolsId, webBridgeId, storeId }),
    //       )
    //     }),
    //   ),
    //   Stream.runDrain,
    //   Effect.ignoreLogged,
    //   Effect.forkScoped,
    // )

    yield* Effect.never
  }).pipe(Effect.scoped)

const listenToBrowserExtensionBridge = ({
  appHostId,
  connectToDevtools,
}: {
  appHostId: string
  connectToDevtools: (coordinatorMessagePort: MessagePort) => Effect.Effect<void, UnexpectedError, Scope.Scope>
}) =>
  Effect.gen(function* () {
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
