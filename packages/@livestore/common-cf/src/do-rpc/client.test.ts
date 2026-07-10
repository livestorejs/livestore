import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Fiber, Rpc, RpcClient, RpcGroup, Schema, Stream } from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { layerProtocolDurableObject } from './client.ts'
import { toDurableObjectHandler } from './server.ts'

class Rpcs extends RpcGroup.make(
  Rpc.make('BigStream', {
    payload: Schema.Struct({ n: Schema.Number }),
    success: Schema.Struct({
      seqNum: Schema.Number,
      name: Schema.String,
      args: Schema.Struct({ a: Schema.Number, b: Schema.String }),
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

const makeGatedCallRpc =
  (gateStream: (bytes: Uint8Array) => CfTypes.ReadableStream) =>
  (payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream> =>
    toDurableObjectHandler(Rpcs, { layer: ServerLive })(new Uint8Array(payload)).pipe(
      Effect.flatMap(
        // Narrow on `Uint8Array`; the `ReadableStream` global differs from `CfTypes` across envs.
        (result): Effect.Effect<Uint8Array | CfTypes.ReadableStream> =>
          result instanceof Uint8Array
            ? Effect.succeed(result)
            : Effect.promise(() => collectBytes(result)).pipe(Effect.map(gateStream)),
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
