import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Option,
  Rpc,
  RpcClient,
  RpcClientError,
  RpcGroup,
  Schema,
  Stream,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { DoRpcReadError, layerProtocolDurableObject } from './client.ts'
import { toDurableObjectHandler } from './server.ts'

class Rpcs extends RpcGroup.make(
  Rpc.make('BigStream', {
    payload: Schema.Struct({ n: Schema.Finite }),
    success: Schema.Struct({
      seqNum: Schema.Finite,
      name: Schema.String,
      args: Schema.Struct({ a: Schema.Finite, b: Schema.String }),
    }),
    stream: true,
  }),
  Rpc.make('Echo', {
    payload: Schema.Struct({ text: Schema.String }),
    success: Schema.Struct({ echo: Schema.String }),
  }),
) {}

const READ_CHUNK_SIZE = 4096

const expectedRows = [
  {
    seqNum: 0,
    name: 'event-0',
    args: { a: 0, b: 'x'.repeat(READ_CHUNK_SIZE) },
  },
]

const ServerLive = Rpcs.toLayer({
  BigStream: ({ n }) => Stream.fromIterable(expectedRows.slice(0, n)),
  Echo: ({ text }) => Effect.succeed({ echo: `Echo: ${text}` }),
})

Vitest.live('keeps a straddling stream frame isolated from a concurrent unary response', () =>
  Effect.gen(function* () {
    let signalFirstStreamRead = () => {}
    const firstStreamReadDone = new Promise<void>((resolve) => {
      signalFirstStreamRead = resolve
    })
    let releaseStreamTail = () => {}
    const streamTailReleased = new Promise<void>((resolve) => {
      releaseStreamTail = resolve
    })

    const streamWithGatedTail = (bytes: Uint8Array) => {
      let pos = 0
      let isFirstRead = true
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (pos >= bytes.length) return controller.close()
          if (isFirstRead === false) await streamTailReleased
          controller.enqueue(bytes.subarray(pos, pos + READ_CHUNK_SIZE))
          pos += READ_CHUNK_SIZE
          if (isFirstRead === true) {
            isFirstRead = false
            signalFirstStreamRead()
          }
        },
      })
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type, like server.ts
      return stream as unknown as CfTypes.ReadableStream
    }

    const ProtocolLive = layerProtocolDurableObject({
      callRpc: makeGatedCallRpc(streamWithGatedTail),
      callerContext: { bindingName: 'TEST', durableObjectId: 'id' },
    })

    const result = yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(Rpcs)
      const streamFiber = yield* client.BigStream({ n: expectedRows.length }).pipe(Stream.runCollect, Effect.forkChild)

      yield* Effect.promise(() => firstStreamReadDone)
      const echo = yield* client.Echo({ text: 'hi' }).pipe(Effect.timeout('500 millis'))
      yield* Effect.sync(() => releaseStreamTail())

      const rows = yield* Fiber.join(streamFiber)
      return { rows: Array.from(rows), echo }
    }).pipe(Effect.provide(ProtocolLive), Effect.timeout('2 seconds'))

    Vitest.expect(result.echo).toEqual({ echo: 'Echo: hi' })
    Vitest.expect(result.rows).toEqual(expectedRows)
  }),
)

Vitest.describe('transport failures', () => {
  Vitest.live('fails a unary call with an RpcClientError that keeps the rejected error', () =>
    Effect.gen(function* () {
      const rejected = cloudflareError()

      const exit = yield* RpcClient.make(Rpcs).pipe(
        Effect.flatMap((client) => client.Echo({ text: 'hi' })),
        Effect.exit,
        Effect.provide(protocolWith(() => Promise.reject(rejected))),
        Effect.timeout('2 seconds'),
      )

      Vitest.expect(transportFailureCause(exit)).toBe(rejected)
    }),
  )

  Vitest.live('preserves a read failure through rejected cancellation and releases the reader lock', () =>
    Effect.gen(function* () {
      const rejected = cloudflareError()
      let failedStream: ReadableStream<Uint8Array> | undefined
      const failAfterFirstRead = (bytes: Uint8Array) => {
        let isFirstRead = true
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (isFirstRead === false) return controller.error(rejected)
            isFirstRead = false
            controller.enqueue(bytes.subarray(0, READ_CHUNK_SIZE))
          },
        })
        failedStream = stream
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type, like server.ts
        return stream as unknown as CfTypes.ReadableStream
      }

      const exit = yield* RpcClient.make(Rpcs).pipe(
        Effect.flatMap((client) => client.BigStream({ n: expectedRows.length }).pipe(Stream.runCollect)),
        Effect.exit,
        Effect.provide(protocolWith(makeGatedCallRpc(failAfterFirstRead))),
        Effect.timeout('2 seconds'),
      )

      Vitest.expect(transportFailureCause(exit)).toBe(rejected)
      Vitest.expect(failedStream?.locked).toBe(false)
    }),
  )

  Vitest.live('fails only the request whose call rejected', () =>
    Effect.gen(function* () {
      let releaseStream = () => {}
      const streamReleased = new Promise<void>((resolve) => {
        releaseStream = resolve
      })
      const gatedUntilReleased = (bytes: Uint8Array) => {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            await streamReleased
            controller.enqueue(bytes)
            controller.close()
          },
        })
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type, like server.ts
        return stream as unknown as CfTypes.ReadableStream
      }
      const callStream = makeGatedCallRpc(gatedUntilReleased)
      let calls = 0
      const callRpc = (payload: Uint8Array) => {
        calls++
        return calls === 1 ? callStream(payload) : Promise.reject(cloudflareError())
      }

      const result = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(Rpcs)
        const streamFiber = yield* client
          .BigStream({ n: expectedRows.length })
          .pipe(Stream.runCollect, Effect.forkChild)
        yield* Effect.yieldNow
        const echoExit = yield* client.Echo({ text: 'hi' }).pipe(Effect.exit)
        yield* Effect.sync(() => releaseStream())
        const rows = yield* Fiber.join(streamFiber)
        return { echoExit, rows: Array.from(rows) }
      }).pipe(Effect.provide(protocolWith(callRpc)), Effect.timeout('2 seconds'))

      Vitest.expect(transportFailureCause(result.echoExit)).toBeInstanceOf(Error)
      Vitest.expect(result.rows).toEqual(expectedRows)
    }),
  )

  Vitest.live('interruption releases the reader even when remote cancellation never completes', () =>
    Effect.gen(function* () {
      const stream = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) })
      const exit = yield* RpcClient.make(Rpcs).pipe(
        Effect.flatMap((client) => client.BigStream({ n: 1 }).pipe(Stream.runDrain, Effect.timeout('20 millis'))),
        Effect.exit,
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge the platform stream to the CF type
        Effect.provide(protocolWith(async () => stream as unknown as CfTypes.ReadableStream)),
        Effect.timeout('2 seconds'),
      )
      Vitest.expect(Exit.isFailure(exit)).toBe(true)
      Vitest.expect(stream.locked).toBe(false)
    }),
  )

  Vitest.live('reports a truncated response as a read failure instead of waiting forever for an RPC exit', () =>
    Effect.gen(function* () {
      const stream = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
      const exit = yield* RpcClient.make(Rpcs).pipe(
        Effect.flatMap((client) => client.BigStream({ n: 1 }).pipe(Stream.runCollect)),
        Effect.exit,
        // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge the platform stream to the CF type
        Effect.provide(protocolWith(async () => stream as unknown as CfTypes.ReadableStream)),
        Effect.timeout('2 seconds'),
      )
      Vitest.expect(transportFailureCause(exit)).toEqual(new Error('RPC stream ended before its exit'))
    }),
  )
})

const cloudflareError = () => Object.assign(new Error('Network connection lost.'), { retryable: true })

const protocolWith = (callRpc: (payload: Uint8Array) => Promise<Uint8Array | CfTypes.ReadableStream>) =>
  layerProtocolDurableObject({ callRpc, callerContext: { bindingName: 'TEST', durableObjectId: 'id' } })

/** The rejected error carried by a typed transport failure, or `undefined` for any other outcome (including a defect). */
const transportFailureCause = (exit: Exit.Exit<unknown, unknown>): unknown => {
  if (Exit.isSuccess(exit) === true) return undefined
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  if (error instanceof RpcClientError.RpcClientError === false) return undefined
  if (error.reason._tag !== 'RpcClientDefect') return undefined
  return error.reason.cause instanceof DoRpcReadError ? error.reason.cause.cause : error.reason.cause
}

const makeGatedCallRpc =
  (gateStream: (bytes: Uint8Array) => CfTypes.ReadableStream) =>
  (payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream> =>
    toDurableObjectHandler(Rpcs, { layer: ServerLive })(new Uint8Array(payload)).pipe(
      Effect.filterOrElse(
        // Narrow on `Uint8Array`; the `ReadableStream` global differs from `CfTypes` across envs.
        (result): result is Uint8Array<ArrayBuffer> => result instanceof Uint8Array,
        (result) => Effect.promise(() => collectBytes(result)).pipe(Effect.map(gateStream)),
      ),
      Effect.runPromise,
    )

const collectBytes = async (stream: CfTypes.ReadableStream) => {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done === true) break
    parts.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
