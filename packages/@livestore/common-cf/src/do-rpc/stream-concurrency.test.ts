import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Fiber, Rpc, RpcClient, RpcGroup, Schema, Stream } from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { layerProtocolDurableObject } from './client.ts'
import { toDurableObjectHandler } from './server.ts'

/**
 * Exercises interleaved streaming and unary DO-RPC responses with a stream read
 * that ends in the middle of a msgpack frame. The gate makes Echo decode before
 * the stream tail is delivered.
 */

const Row = Schema.Struct({
  seqNum: Schema.Number,
  name: Schema.String,
  args: Schema.Struct({ a: Schema.Number, b: Schema.String }),
})

class Rpcs extends RpcGroup.make(
  Rpc.make('BigStream', { payload: Schema.Struct({ n: Schema.Number }), success: Row, stream: true }),
  Rpc.make('Echo', {
    payload: Schema.Struct({ text: Schema.String }),
    success: Schema.Struct({ echo: Schema.String }),
  }),
) {}

const ROW_COUNT = 400
const DO_RPC_READ_CHUNK = 4096

const expectedRows = Array.from({ length: ROW_COUNT }, (_, i) => ({
  seqNum: i,
  name: `event-${i}`,
  args: { a: i, b: `payload-${i}-${'x'.repeat(30)}` },
}))

const ServerLive = Rpcs.toLayer({
  BigStream: ({ n }) => Stream.fromIterable(expectedRows.slice(0, n)),
  Echo: ({ text }) => Effect.succeed({ echo: `Echo: ${text}` }),
})

Vitest.describe('do-rpc stream/unary concurrency', () => {
  Vitest.scopedLive(
    'a straddling catchup stream is not corrupted by a concurrent unary decode',
    () =>
      Effect.gen(function* () {
        let signalFirstRead = () => {}
        const firstReadDone = new Promise<void>((resolve) => {
          signalFirstRead = resolve
        })
        let openGate = () => {}
        const gate = new Promise<void>((resolve) => {
          openGate = resolve
        })

        const reChunkWithGate = (bytes: Uint8Array): CfTypes.ReadableStream => {
          let pos = 0
          let firstRead = true
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (pos >= bytes.length) return controller.close()
              if (firstRead === false) await gate
              controller.enqueue(bytes.subarray(pos, pos + DO_RPC_READ_CHUNK))
              pos += DO_RPC_READ_CHUNK
              if (firstRead === true) {
                firstRead = false
                signalFirstRead()
              }
            },
          })
          // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- bridge platform ReadableStream to the CF type, like server.ts
          return stream as unknown as CfTypes.ReadableStream
        }

        const callRpc = (payload: Uint8Array): Promise<Uint8Array | CfTypes.ReadableStream> =>
          toDurableObjectHandler(Rpcs, { layer: ServerLive })(new Uint8Array(payload)).pipe(
            Effect.flatMap(
              // Narrow on `Uint8Array`; the `ReadableStream` global differs from `CfTypes` across envs.
              (result): Effect.Effect<Uint8Array | CfTypes.ReadableStream> =>
                result instanceof Uint8Array
                  ? Effect.succeed(result)
                  : Effect.promise(() => collectBytes(result)).pipe(Effect.map((bytes) => reChunkWithGate(bytes))),
            ),
            Effect.runPromise,
          )

        const ProtocolLive = layerProtocolDurableObject({
          callRpc,
          callerContext: { bindingName: 'TEST', durableObjectId: 'id' },
        })

        const result = yield* Effect.gen(function* () {
          const client = yield* RpcClient.make(Rpcs)
          const streamFiber = yield* client.BigStream({ n: ROW_COUNT }).pipe(Stream.runCollect, Effect.fork)

          yield* Effect.promise(() => firstReadDone)
          const echo = yield* client.Echo({ text: 'hi' })
          yield* Effect.sync(() => openGate())

          const rows = yield* Fiber.join(streamFiber)
          return { rows: Array.from(rows), echo }
        }).pipe(Effect.provide(ProtocolLive), Effect.timeout('10 seconds'))

        Vitest.expect(result.echo).toEqual({ echo: 'Echo: hi' })
        Vitest.expect(result.rows.length).toBe(ROW_COUNT)
        Vitest.expect(result.rows).toEqual(expectedRows)
      }),
    { timeout: 30_000 },
  )
})

const collectBytes = async (stream: CfTypes.ReadableStream): Promise<Uint8Array> => {
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
