import { BackendIdMismatchError, IsOfflineError, ServerAheadError, SyncBackend } from '@livestore/common'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import { EventSequenceNumber } from '@livestore/common/schema'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  KeyValueStore,
  Layer,
  Option,
  Stream,
} from '@livestore/utils/effect'

import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import { makeDoRpcSync, type SyncBackendRpcStub } from './do-rpc-client.ts'

Vitest.describe('DO-RPC sync client transport failures', () => {
  Vitest.effect('a retryable rejection fails the pull as offline after a backoff', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit, delays } = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
      expectBackoff(delays[0]!, 1_000)
    }),
  )

  Vitest.effect('a retryable push rejection fails as offline', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit } = yield* runRecordingBackoff(backend.push([event]))

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
    }),
  )

  Vitest.effect('a retryable ping rejection fails as offline', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit } = yield* runRecordingBackoff(backend.ping)

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
    }),
  )

  Vitest.describe('keeps terminal failures terminal', () => {
    // Overload wins over `retryable`, and `remote` alone does not mean retryable (infrastructure errors can carry it).
    const terminal = [
      { name: 'overloaded and retryable', flags: { overloaded: true, retryable: true } },
      { name: 'remote only', flags: { remote: true } },
      { name: 'unflagged', flags: {} },
    ]

    for (const { name, flags } of terminal) {
      Vitest.effect(`${name}: pull dies with the original error without waiting`, () =>
        Effect.gen(function* () {
          const rejected = cloudflareError(flags)
          const { backend } = yield* makeBackend([rejectWith(rejected)])

          const { exit, delays } = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))

          Vitest.expect(defectOf(exit)).toBe(rejected)
          Vitest.expect(delays).toEqual([])
        }),
      )

      Vitest.effect(`${name}: push dies with the original error`, () =>
        Effect.gen(function* () {
          const rejected = cloudflareError(flags)
          const { backend } = yield* makeBackend([rejectWith(rejected)])

          const { exit } = yield* runRecordingBackoff(backend.push([event]))

          Vitest.expect(defectOf(exit)).toBe(rejected)
        }),
      )
    }
  })

  Vitest.describe('passes application errors through unchanged', () => {
    Vitest.effect('pull: BackendIdMismatchError', () =>
      Effect.gen(function* () {
        const { backend } = yield* makeBackend([
          serve({ pull: () => Stream.fail(new BackendIdMismatchError({ expected: 'a', received: 'b' })) }),
        ])

        const { exit } = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))

        Vitest.expect(failureOf(exit)).toBeInstanceOf(BackendIdMismatchError)
      }),
    )

    Vitest.effect('push: ServerAheadError', () =>
      Effect.gen(function* () {
        const { backend } = yield* makeBackend([
          serve({
            push: () =>
              Effect.fail(
                new ServerAheadError({
                  minimumExpectedNum: EventSequenceNumber.Global.make(2),
                  providedNum: EventSequenceNumber.Global.make(1),
                }),
              ),
          }),
        ])

        const { exit } = yield* runRecordingBackoff(backend.push([event]))

        Vitest.expect(failureOf(exit)).toBeInstanceOf(ServerAheadError)
      }),
    )
  })

  Vitest.describe('backoff', () => {
    Vitest.effect('grows to the cap across pulls that each deliver a page and then fail', () =>
      Effect.gen(function* () {
        const failure = pageThenRejectWith(cloudflareError({ retryable: true }))
        const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
        const { backend } = yield* makeBackend(expectedDelays.map(() => failure))

        for (const expectedDelay of expectedDelays) {
          const { exit, delays } = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))
          Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
          Vitest.expect(delays).toHaveLength(1)
          expectBackoff(delays[0]!, expectedDelay)
        }
      }),
    )

    Vitest.effect('interrupts a pull while it is waiting to retry', () =>
      Effect.gen(function* () {
        const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])
        const clock = yield* Clock.Clock
        const waiting = yield* Deferred.make<void>()
        const fiber = yield* backend.pull(Option.none()).pipe(
          Stream.runCollect,
          Effect.provideService(Clock.Clock, {
            ...clock,
            sleep: (duration) => Deferred.succeed(waiting, undefined).pipe(Effect.andThen(clock.sleep(duration))),
          }),
          Effect.forkChild,
        )

        yield* Deferred.await(waiting)
        Vitest.expect(fiber.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(fiber)
        Vitest.expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
      }),
    )

    Vitest.effect('resets once a pull completes its catch-up', () =>
      Effect.gen(function* () {
        const failure = rejectWith(cloudflareError({ retryable: true }))
        const { backend } = yield* makeBackend([
          failure,
          failure,
          serve({ pull: () => Stream.make(pullResponse(SyncBackend.pageInfoNoMore)) }),
          failure,
        ])
        const pull = runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))

        yield* pull
        yield* pull
        const completed = yield* pull
        const afterReset = yield* pull

        Vitest.expect(Exit.isSuccess(completed.exit)).toBe(true)
        expectBackoff(afterReset.delays[0]!, 1_000)
      }),
    )
  })

  Vitest.effect('recovers on a fresh stub after a stub breaks', () =>
    Effect.gen(function* () {
      const broken = rejectWith(cloudflareError({ retryable: true }))
      const healthy = serve({ pull: () => Stream.make(pullResponse(SyncBackend.pageInfoNoMore)) })
      const { backend } = yield* makeBackend([broken, healthy])

      const first = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))
      const second = yield* runRecordingBackoff(backend.pull(Option.none()).pipe(Stream.runCollect))

      Vitest.expect(failureOf(first.exit)).toBeInstanceOf(IsOfflineError)
      Vitest.expect(Exit.isSuccess(second.exit)).toBe(true)
    }),
  )
})

type CallRpc = (payload: Uint8Array) => Promise<Uint8Array | CfTypes.ReadableStream>

const backendId = 'backend'

const event = {
  name: 'todoCreated',
  args: {},
  seqNum: EventSequenceNumber.Global.make(1),
  parentSeqNum: EventSequenceNumber.Global.make(0),
  clientId: 'client',
  sessionId: 'session',
}

const pullResponse = (pageInfo: SyncBackend.PullResPageInfo) => ({
  rpcRequestId: '0',
  batch: [{ eventEncoded: event, metadata: Option.none() }],
  pageInfo,
  backendId,
})

/** A Cloudflare DO error carries runtime flags as own properties on the thrown `Error`. */
const cloudflareError = (flags: { retryable?: boolean; overloaded?: boolean; remote?: boolean }) =>
  Object.assign(new Error('Network connection lost.'), flags)

const rejectWith =
  (error: Error): CallRpc =>
  () =>
    Promise.reject(error)

/** Serves the real handler, so each call carries encoded responses exactly as a backend DO sends them. */
const serve =
  (handlers: {
    pull?: () => Stream.Stream<ReturnType<typeof pullResponse>, BackendIdMismatchError>
    push?: () => Effect.Effect<{}, ServerAheadError>
  }): CallRpc =>
  (payload) =>
    toDurableObjectHandler(SyncDoRpc, {
      layer: SyncDoRpc.toLayer({
        'SyncDoRpc.Pull': () => handlers.pull?.() ?? Stream.empty,
        'SyncDoRpc.Push': () => handlers.push?.() ?? Effect.succeed({}),
        'SyncDoRpc.Ping': () => Effect.void,
        'SyncDoRpc.Unsubscribe': () => Effect.void,
      }),
    })(new Uint8Array(payload)).pipe(Effect.runPromise)

/** Delivers one page, then rejects the next stream read with `error`. */
const pageThenRejectWith =
  (error: Error): CallRpc =>
  async (payload) => {
    const response = await serve({
      pull: () => Stream.make(pullResponse(SyncBackend.pageInfoMoreUnknown)),
    })(payload)
    if (response instanceof Uint8Array) return response
    const source = response.getReader()
    // Keep only the page frame; replace the normal RPC exit with a transport failure.
    const { value } = await source.read()
    await source.cancel()
    source.releaseLock()
    let sentPage = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentPage === true) return controller.error(error)
        sentPage = true
        controller.enqueue(value)
      },
    })
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type
    return stream as unknown as CfTypes.ReadableStream
  }

/** Each supplied RPC implementation belongs to one stub, and stays attached if that stub is reused. */
const makeBackend = (stubs: ReadonlyArray<CallRpc>) =>
  Effect.gen(function* () {
    let nextStub = 0
    const backend = yield* makeDoRpcSync({
      getSyncBackendStub: () => {
        const rpc = stubs[nextStub++]
        if (rpc === undefined) throw new Error('Unexpected extra stub')
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- a test double only needs `rpc`
        return { rpc } as unknown as SyncBackendRpcStub
      },
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- only live pulls read the DO state
      durableObjectState: {} as CfTypes.DurableObjectState,
      durableObjectContext: { bindingName: 'CLIENT_DO', durableObjectId: 'client-do' },
    })({ storeId: 'store', clientId: 'client', payload: undefined }).pipe(
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, KeyValueStore.layerMemory)),
    )

    return { backend }
  })

/** Observe the waits requested by production code without polling fibers or waiting on wall-clock timers. */
const runRecordingBackoff = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const delays: number[] = []
    const exit = yield* effect.pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep: (duration) =>
          Effect.sync(() => {
            delays.push(Duration.toMillis(duration))
          }),
      }),
      Effect.exit,
    )
    return { exit, delays }
  })

const expectBackoff = (delay: number, baseMs: number) => {
  Vitest.expect(delay).toBeGreaterThanOrEqual(baseMs * 0.8)
  Vitest.expect(delay).toBeLessThanOrEqual(baseMs * 1.2)
}

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) === true ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const defectOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) === true && Option.isNone(Cause.findErrorOption(exit.cause)) === true
    ? Cause.squash(exit.cause)
    : undefined
