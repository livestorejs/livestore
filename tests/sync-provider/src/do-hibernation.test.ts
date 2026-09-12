import { expect } from 'vitest'

import { EventSequenceNumber } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { SyncMessage } from '@livestore/sync-cf/common'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Duration, Effect, Exit, Option, Schema } from '@livestore/utils/effect'

import {
  awaitDelivery,
  collectReceivedIds,
  makeEventFactory,
  probeSyncDo,
  setupProviderRuntime,
  staysResidentWhileWarm,
  SyncDoProbeError,
  syncProvider,
} from './do-idle-helpers.ts'
import * as CloudflareWsProvider from './providers/cloudflare-ws.ts'
import { isProviderSelected } from './providers/registry.ts'

const idleWindow: Duration.Input = '20 seconds' // workerd evicts somewhere between 9s and 11s idle
// The error/success holes are irrelevant for an Interrupt, but the JSON codec still validates its full wire shape.
const decodeInterruptedExit = Schema.decodeUnknownSync(
  Schema.toCodecJson(Schema.Exit(Schema.Void, Schema.Never, Schema.Never)),
)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))
const encodePullPayload = Schema.encodeSync(
  Schema.toCodecJson(
    Schema.Struct({
      storeId: Schema.String,
      live: Schema.Boolean,
      ...SyncMessage.PullRequest.fields,
    }),
  ),
)
const decodeRpcWireMessage = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      requestId: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
      exit: Schema.optional(Schema.Unknown),
    }),
  ),
)

// Selected by provider key, not by suite title, so renaming this suite cannot drop it from CI.
const describeWsDo = Vitest.describe.skipIf(isProviderSelected('cf-ws-do') === false)

describeWsDo(`${CloudflareWsProvider.doSqlite.name} sync provider — DO hibernation`, () => {
  const getContext = setupProviderRuntime(CloudflareWsProvider.doSqlite.layer)

  Vitest.live('an idle WS client lets the DO hibernate, and a warm DO stays resident', () =>
    Effect.gen(function* () {
      const observed = yield* Effect.all(
        {
          idle: hibernatesWhenIdle({ livePull: false }),
          livePull: hibernatesWhenIdle({ livePull: true }),
          warmControl: staysResidentWhileWarm({ idleWindow, storeIdPrefix: 'hibernation-warm' }),
        },
        { concurrency: 'unbounded' },
      )

      expect(observed).toEqual({ idle: true, livePull: true, warmControl: false })
    }).pipe(Effect.provide(getContext())),
  )

  Vitest.live('live pulls receive one valid interrupted Exit before and after reconstruction', () =>
    Effect.gen(function* () {
      const { port } = yield* syncProvider
      const storeId = `hibernation-interrupt-${nanoid()}`
      const ws = yield* openWebSocket({ port, storeId })

      yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()))

      const warmRequestId = 'warm-pull'
      yield* startLivePull({ ws, storeId, requestId: warmRequestId })
      const warmExits = yield* sendAndCollectRpcMessages(
        ws,
        { _tag: 'Interrupt', requestId: warmRequestId },
        (message) => message._tag === 'Exit' && message.requestId === warmRequestId,
      )
      assertSingleInterruptedExit(warmExits, warmRequestId)

      const restoredRequestId = 'restored-pull'
      yield* startLivePull({ ws, storeId, requestId: restoredRequestId })

      const before = yield* probeWithOpenSocket({ port, storeId })
      yield* Effect.sleep(idleWindow)
      const after = yield* probeWithOpenSocket({ port, storeId })
      expect(after).not.toBe(before)

      const currentRequestId = 'current-pull'
      yield* startLivePull({ ws, storeId, requestId: currentRequestId })
      const currentExits = yield* sendAndCollectRpcMessages(
        ws,
        { _tag: 'Interrupt', requestId: currentRequestId },
        (message) => message._tag === 'Exit' && message.requestId === currentRequestId,
      )
      assertSingleInterruptedExit(currentExits, currentRequestId)

      const restoredExits = yield* sendAndCollectRpcMessages(
        ws,
        { _tag: 'Interrupt', requestId: restoredRequestId },
        (message) => message._tag === 'Exit' && message.requestId === restoredRequestId,
      )
      assertSingleInterruptedExit(restoredExits, restoredRequestId)

      const probe = yield* probeSyncDo({ port, storeId })
      expect(probe.pullRequestIds).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(getContext())),
  )

  Vitest.live('terminal pull exits remove persisted fan-out request ids', () =>
    Effect.gen(function* () {
      const { port } = yield* syncProvider
      const storeId = `pull-exit-cleanup-${nanoid()}`
      const ws = yield* openWebSocket({ port, storeId })

      yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()))

      yield* runPullToExit({ ws, storeId, requestId: 'completed-pull', live: false, cursor: Option.none() })
      yield* runPullToExit({
        ws,
        storeId,
        requestId: 'failed-pull',
        live: true,
        cursor: Option.some({ backendId: 'stale-backend', eventSequenceNumber: EventSequenceNumber.Global.make(0) }),
      })

      const probe = yield* probeSyncDo({ port, storeId })
      expect(probe.pullRequestIds).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(getContext())),
  )
})

const eventClient = EventFactory.clientIdentity('hibernation-client', 'hibernation-session')

const probeWithOpenSocket = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.gen(function* () {
    const probe = yield* probeSyncDo({ port, storeId })
    if (probe.webSocketCount === 0) {
      return yield* new SyncDoProbeError({
        message: `no websocket attached to ${storeId}; hibernation claim would be vacuous`,
      })
    }
    return probe.instanceId
  })

const hibernatesWhenIdle = ({ livePull }: { livePull: boolean }) =>
  Effect.gen(function* () {
    const { makeProvider, port } = yield* syncProvider
    const storeId = `hibernation-${livePull === true ? 'live-pull' : 'idle'}-${nanoid()}`
    const syncBackend = yield* makeProvider({ storeId, clientId: eventClient.clientId, payload: undefined })
    const factory = makeEventFactory({ client: eventClient, startSeq: 1, initialParent: 'root' })

    yield* syncBackend.connect

    const received = livePull === true ? yield* collectReceivedIds(syncBackend) : []

    if (livePull === true) {
      // A dead pull leaves no park, so "it hibernated" would pass for the wrong reason.
      yield* Effect.sleep('1 second')
      yield* syncBackend.push([factory.todoCreated.next({ id: 'before-idle', text: 'before', completed: false })])
      yield* awaitDelivery({ received, id: 'before-idle' })
    }

    const before = yield* probeWithOpenSocket({ port, storeId })
    yield* Effect.sleep(idleWindow)
    const after = yield* probeWithOpenSocket({ port, storeId })

    if (livePull === true) {
      yield* syncBackend.push([factory.todoCreated.next({ id: 'after-idle', text: 'after', completed: false })])
      yield* awaitDelivery({ received, id: 'after-idle' })
    }

    return before !== after
  })

type RpcWireMessage = ReturnType<typeof decodeRpcWireMessage>

const startLivePull = ({ ws, storeId, requestId }: { ws: globalThis.WebSocket; storeId: string; requestId: string }) =>
  sendAndWaitForRpcMessage(
    ws,
    {
      _tag: 'Request',
      id: requestId,
      tag: 'SyncWsRpc.Pull',
      payload: encodePullPayload({ storeId, live: true, cursor: Option.none() }),
      headers: [],
    },
    (message) => message._tag === 'Chunk' && message.requestId === requestId,
  ).pipe(Effect.andThen(Effect.sync(() => ws.send(encodeJson({ _tag: 'Ack', requestId })))))

const runPullToExit = ({
  ws,
  storeId,
  requestId,
  live,
  cursor,
}: {
  ws: globalThis.WebSocket
  storeId: string
  requestId: string
  live: boolean
  cursor: SyncMessage.PullRequest['cursor']
}) =>
  sendAndWaitForRpcMessage(
    ws,
    {
      _tag: 'Request',
      id: requestId,
      tag: 'SyncWsRpc.Pull',
      payload: encodePullPayload({ storeId, live, cursor }),
      headers: [],
    },
    (message) => message._tag === 'Exit' && message.requestId === requestId,
    {
      onMessage: (message) => {
        if (message._tag === 'Chunk' && message.requestId === requestId) {
          ws.send(encodeJson({ _tag: 'Ack', requestId }))
        }
      },
    },
  )

const assertSingleInterruptedExit = (messages: ReadonlyArray<RpcWireMessage>, requestId: string) => {
  expect(messages).toHaveLength(1)
  const message = messages[0]!
  expect(message).toMatchObject({ _tag: 'Exit', requestId })
  expect(message.exit).toBeDefined()
  expect(Exit.hasInterrupts(decodeInterruptedExit(message.exit))).toBe(true)
}

const openWebSocket = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.callback<globalThis.WebSocket, SyncDoProbeError>((resume, signal) => {
    const ws = new WebSocket(`ws://localhost:${port}?storeId=${encodeURIComponent(storeId)}&transport=ws`)
    let settled = false
    const cleanup = () => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const finish = (effect: Effect.Effect<globalThis.WebSocket, SyncDoProbeError>) => {
      if (settled === true) return
      settled = true
      cleanup()
      resume(effect)
    }
    const onOpen = () => finish(Effect.succeed(ws))
    const onError = () => finish(Effect.fail(new SyncDoProbeError({ message: 'WebSocket failed to open' })))
    const onAbort = () => {
      cleanup()
      ws.close()
    }

    ws.addEventListener('open', onOpen, { once: true })
    ws.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
  })

const sendAndWaitForRpcMessage = (
  ws: globalThis.WebSocket,
  outgoing: object,
  matches: (message: RpcWireMessage) => boolean,
  options?: {
    timeout?: Duration.Input
    onMessage?: (message: RpcWireMessage) => void
  },
) =>
  Effect.callback<RpcWireMessage, SyncDoProbeError>((resume, signal) => {
    let settled = false
    const cleanup = () => {
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onError)
      ws.removeEventListener('error', onError)
      signal.removeEventListener('abort', cleanup)
    }
    const finish = (effect: Effect.Effect<RpcWireMessage, SyncDoProbeError>) => {
      if (settled === true) return
      settled = true
      cleanup()
      resume(effect)
    }
    const onMessage = (event: MessageEvent) => {
      try {
        const message = decodeRpcWireMessage(String(event.data))
        options?.onMessage?.(message)
        if (matches(message) === true) finish(Effect.succeed(message))
      } catch (cause) {
        finish(Effect.fail(new SyncDoProbeError({ message: `Invalid RPC response: ${String(cause)}` })))
      }
    }
    const onError = () =>
      finish(Effect.fail(new SyncDoProbeError({ message: 'WebSocket closed before the expected RPC message' })))

    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onError, { once: true })
    ws.addEventListener('error', onError, { once: true })
    ws.send(encodeJson(outgoing))
    signal.addEventListener('abort', cleanup, { once: true })
  }).pipe(Effect.timeout(options?.timeout ?? '5 seconds'))

const sendAndCollectRpcMessages = (
  ws: globalThis.WebSocket,
  outgoing: object,
  matches: (message: RpcWireMessage) => boolean,
  duration: Duration.Input = '500 millis',
) =>
  Effect.callback<ReadonlyArray<RpcWireMessage>, SyncDoProbeError>((resume, signal) => {
    const messages: RpcWireMessage[] = []
    let settled = false
    const timer = setTimeout(() => finish(Effect.succeed(messages)), Duration.toMillis(duration))
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onError)
      ws.removeEventListener('error', onError)
      signal.removeEventListener('abort', cleanup)
    }
    const finish = (effect: Effect.Effect<ReadonlyArray<RpcWireMessage>, SyncDoProbeError>) => {
      if (settled === true) return
      settled = true
      cleanup()
      resume(effect)
    }
    const onMessage = (event: MessageEvent) => {
      try {
        const message = decodeRpcWireMessage(String(event.data))
        if (matches(message) === true) messages.push(message)
      } catch (cause) {
        finish(Effect.fail(new SyncDoProbeError({ message: `Invalid RPC response: ${String(cause)}` })))
      }
    }
    const onError = () =>
      finish(Effect.fail(new SyncDoProbeError({ message: 'WebSocket closed while collecting RPC messages' })))

    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onError, { once: true })
    ws.addEventListener('error', onError, { once: true })
    ws.send(encodeJson(outgoing))
    signal.addEventListener('abort', cleanup, { once: true })
  })
