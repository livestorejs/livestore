import { expect, it } from 'vitest'

import * as DevtoolsWeb from '@livestore/adapter-web/devtools-web-channel'
import { Deferred, Effect, Fiber, Schema, Stream } from '@livestore/utils/effect'
import { WebChannelBrowser } from '@livestore/utils/effect/browser'

/** Delivers at a deterministic point; messages without listeners are deliberately lost. */
class TestWindow extends EventTarget {
  onRequest = () => {}

  postMessage(data: { message: { _tag: string } }) {
    this.dispatchEvent(new MessageEvent('message', { data }))
    if (data.message._tag === 'ClientSessionContentscriptMainReq') this.onRequest()
  }
}

const session = DevtoolsWeb.ClientSessionContentscriptMainReq.make({
  storeId: 'store',
  clientId: 'client',
  sessionId: 'session',
})

const makeClient = (window: TestWindow, legacy = false) =>
  WebChannelBrowser.windowChannel({
    listenWindow: window as unknown as Window,
    sendWindow: window as unknown as Window,
    schema: {
      listen: legacy === true ? DevtoolsWeb.ClientSessionContentscriptMainRes : DevtoolsWeb.ContentscriptMainMessage,
      send: DevtoolsWeb.ClientSessionContentscriptMainReq,
    },
    ids: { own: 'client-session-static', other: 'contentscript-main-static' },
  })

const makeExtension = (window: TestWindow) =>
  WebChannelBrowser.windowChannel({
    listenWindow: window as unknown as Window,
    sendWindow: window as unknown as Window,
    schema: {
      listen: DevtoolsWeb.ClientSessionContentscriptMainReq,
      send: DevtoolsWeb.ContentscriptMainMessage,
    },
    ids: { own: 'contentscript-main-static', other: 'client-session-static' },
  })

for (const order of ['app-first', 'extension-first'] as const) {
  it(`discovers the session with ${order} startup and no timed retries`, () =>
    Effect.gen(function* () {
      const window = new TestWindow()
      const firstRequest = yield* Deferred.make<void>()
      window.onRequest = () => {
        Deferred.doneUnsafe(firstRequest, Effect.void)
      }
      const extensionBeforeApp = order === 'extension-first' ? yield* makeExtension(window) : undefined
      if (extensionBeforeApp !== undefined) yield* extensionBeforeApp.send(DevtoolsWeb.ContentscriptMainReady.make({}))
      const client = yield* makeClient(window)
      const app = yield* DevtoolsWeb.requestContentscriptMain(client, session).pipe(Effect.forkScoped)
      yield* Deferred.await(firstRequest)
      const extension = extensionBeforeApp ?? (yield* makeExtension(window))
      if (extensionBeforeApp === undefined) yield* extension.send(DevtoolsWeb.ContentscriptMainReady.make({}))
      const request = yield* extension.listen.pipe(
        Stream.mapEffect(Effect.fromResult),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption),
      )
      expect(request).toEqual(session)
      yield* extension.send(DevtoolsWeb.ClientSessionContentscriptMainRes.make({ tabId: 42 }))
      expect((yield* Fiber.join(app)).tabId).toBe(42)
    }).pipe(Effect.scoped, Effect.runPromise))
}

it('a new app connects to an extension that never announces readiness', () =>
  Effect.gen(function* () {
    const window = new TestWindow()
    const extension = yield* makeExtension(window)
    const client = yield* makeClient(window)
    const app = yield* DevtoolsWeb.requestContentscriptMain(client, session).pipe(Effect.forkScoped)
    yield* extension.listen.pipe(Stream.take(1), Stream.runDrain)
    yield* extension.send(DevtoolsWeb.ClientSessionContentscriptMainRes.make({ tabId: 42 }))
    expect((yield* Fiber.join(app)).tabId).toBe(42)
  }).pipe(Effect.scoped, Effect.runPromise))

it('a legacy app ignores readiness and its one registration request is buffered during extension setup', () =>
  Effect.gen(function* () {
    const window = new TestWindow()
    const extension = yield* makeExtension(window)
    const client = yield* makeClient(window, true)
    yield* extension.send(DevtoolsWeb.ContentscriptMainReady.make({}))
    yield* client.send(session)
    // The extension has not started consuming requests yet (e.g. its iframe is loading).
    const request = yield* extension.listen.pipe(
      Stream.mapEffect(Effect.fromResult),
      Stream.runHead,
      Effect.flatMap(Effect.fromOption),
    )
    expect(request).toEqual(session)
    yield* extension.send(DevtoolsWeb.ClientSessionContentscriptMainRes.make({ tabId: 42 }))
    const response = yield* client.listen.pipe(
      Stream.mapEffect(Effect.fromResult),
      Stream.filter(Schema.is(DevtoolsWeb.ClientSessionContentscriptMainRes)),
      Stream.runHead,
      Effect.flatMap(Effect.fromOption),
    )
    expect(response.tabId).toBe(42)
  }).pipe(Effect.scoped, Effect.runPromise))
