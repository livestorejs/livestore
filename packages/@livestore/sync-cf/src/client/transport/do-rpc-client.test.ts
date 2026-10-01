import { BackendIdMismatchError, IsOfflineError, ServerAheadError, SyncBackend } from '@livestore/common'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import { EventSequenceNumber } from '@livestore/common/schema'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Cause,
  Effect,
  Exit,
  FetchHttpClient,
  KeyValueStore,
  Layer,
  Option,
  Stream,
  TestClock,
} from '@livestore/utils/effect'

import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import { makeDoRpcSync, type SyncBackendRpcStub } from './do-rpc-client.ts'

Vitest.describe('DO-RPC sync client transport failures', () => {
  Vitest.effect('a retryable rejection fails the pull as offline after a backoff', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit, elapsedMs } = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
      expectBackoff(elapsedMs, 1_000)
    }),
  )

  Vitest.effect('a retryable mid-stream failure keeps the delivered page, then fails as offline', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([pageThenRejectWith(cloudflareError({ retryable: true }))])

      const pages: SyncBackend.PullResPageInfo[] = []
      const { exit } = yield* runAdvancingClock(
        backend.pull(Option.none()).pipe(Stream.runForEach(({ pageInfo }) => Effect.sync(() => pages.push(pageInfo)))),
      )

      Vitest.expect(pages).toEqual([SyncBackend.pageInfoMoreUnknown])
      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
    }),
  )

  Vitest.effect('a retryable push rejection fails as offline', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit } = yield* runAdvancingClock(backend.push([event]))

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
    }),
  )

  Vitest.effect('a retryable ping rejection fails as offline', () =>
    Effect.gen(function* () {
      const { backend } = yield* makeBackend([rejectWith(cloudflareError({ retryable: true }))])

      const { exit } = yield* runAdvancingClock(backend.ping)

      Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
    }),
  )

  Vitest.describe('keeps terminal failures terminal', () => {
    // Overload wins over `retryable`, and `remote` alone does not mean retryable (infrastructure errors can carry it).
    const terminal = [
      { name: 'overloaded and retryable', flags: { overloaded: true, retryable: true } },
      { name: 'remote only', flags: { remote: true } },
    ]

    for (const { name, flags } of terminal) {
      Vitest.effect(`${name}: pull dies with the original error without waiting`, () =>
        Effect.gen(function* () {
          const rejected = cloudflareError(flags)
          const { backend } = yield* makeBackend([rejectWith(rejected)])

          const { exit, elapsedMs } = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))

          Vitest.expect(defectOf(exit)).toBe(rejected)
          Vitest.expect(elapsedMs).toBeLessThan(100)
        }),
      )

      Vitest.effect(`${name}: push dies with the original error`, () =>
        Effect.gen(function* () {
          const rejected = cloudflareError(flags)
          const { backend } = yield* makeBackend([rejectWith(rejected)])

          const { exit } = yield* runAdvancingClock(backend.push([event]))

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

        const { exit } = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))

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

        const { exit } = yield* runAdvancingClock(backend.push([event]))

        Vitest.expect(failureOf(exit)).toBeInstanceOf(ServerAheadError)
      }),
    )
  })

  Vitest.describe('backoff', () => {
    Vitest.effect('grows across pulls that each deliver a page and then fail', () =>
      Effect.gen(function* () {
        const failure = pageThenRejectWith(cloudflareError({ retryable: true }))
        const { backend } = yield* makeBackend([failure, failure, failure])

        const elapsed: number[] = []
        for (let attempt = 0; attempt < 3; attempt++) {
          const { exit, elapsedMs } = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))
          Vitest.expect(failureOf(exit)).toBeInstanceOf(IsOfflineError)
          elapsed.push(elapsedMs)
        }

        expectBackoff(elapsed[0]!, 1_000)
        expectBackoff(elapsed[1]!, 2_000)
        expectBackoff(elapsed[2]!, 4_000)
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
        const pull = runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))

        yield* pull
        yield* pull
        const completed = yield* pull
        const afterReset = yield* pull

        Vitest.expect(Exit.isSuccess(completed.exit)).toBe(true)
        expectBackoff(afterReset.elapsedMs, 1_000)
      }),
    )
  })

  Vitest.effect('recovers on a fresh stub after a stub breaks', () =>
    Effect.gen(function* () {
      const broken = rejectWith(cloudflareError({ retryable: true }))
      const healthy = serve({ pull: () => Stream.make(pullResponse(SyncBackend.pageInfoNoMore)) })
      const { backend } = yield* makeBackend([broken, healthy], { answerBy: 'stub' })

      const first = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))
      const second = yield* runAdvancingClock(backend.pull(Option.none()).pipe(Stream.runCollect))

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

const pullResponse = (pageInfo: SyncBackend.PullResPageInfo) => ({ rpcRequestId: '0', batch: [], pageInfo, backendId })

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
      pull: () => Stream.make(pullResponse(SyncBackend.pageInfoMoreUnknown)).pipe(Stream.concat(Stream.never)),
    })(payload)
    if (response instanceof Uint8Array) return response
    const source = response.getReader()
    let isFirstRead = true
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (isFirstRead === false) return controller.error(error)
        isFirstRead = false
        const { value } = await source.read()
        controller.enqueue(value)
      },
    })
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type
    return stream as unknown as CfTypes.ReadableStream
  }

/**
 * Builds a backend whose n-th RPC call is answered by `calls[n]`. With `answerBy: 'stub'`, the n-th stub answers
 * every call made on it with `calls[n]`, which models a stub that stays broken.
 */
const makeBackend = (calls: ReadonlyArray<CallRpc>, options?: { answerBy: 'call' | 'stub' }) =>
  Effect.gen(function* () {
    let call = 0
    let stub = 0
    const answer = (index: number, payload: Uint8Array) => {
      const next = calls[index]
      return next === undefined ? Promise.reject(new Error(`Unexpected RPC call ${index}`)) : next(payload)
    }

    const backend = yield* makeDoRpcSync({
      getSyncBackendStub: () => {
        const stubIndex = stub++
        const rpc: CallRpc = (payload) => answer(options?.answerBy === 'stub' ? stubIndex : call++, payload)
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

/** Lets real promises settle between simulated clock steps. */
const flushIo = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const CLOCK_STEP_MS = 50

/** Runs `effect` while advancing the test clock in small steps, returning its exit and the simulated time it took. */
const runAdvancingClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    let elapsedMs = 0
    yield* flushIo
    while (fiber.pollUnsafe() === undefined) {
      if (elapsedMs > 60_000) return yield* Effect.die(new Error('The effect did not finish within 60 s'))
      yield* TestClock.adjust(`${CLOCK_STEP_MS} millis`)
      elapsedMs += CLOCK_STEP_MS
      yield* flushIo
    }
    return { exit: fiber.pollUnsafe()!, elapsedMs }
  })

/** Asserts a delay of `baseMs` with ±20 % jitter, allowing one clock step of measurement slack. */
const expectBackoff = (elapsedMs: number, baseMs: number) => {
  Vitest.expect(elapsedMs).toBeGreaterThanOrEqual(baseMs * 0.8)
  Vitest.expect(elapsedMs).toBeLessThanOrEqual(baseMs * 1.2 + CLOCK_STEP_MS)
}

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) === true ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const defectOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) === true && Option.isNone(Cause.findErrorOption(exit.cause)) === true
    ? Cause.squash(exit.cause)
    : undefined
