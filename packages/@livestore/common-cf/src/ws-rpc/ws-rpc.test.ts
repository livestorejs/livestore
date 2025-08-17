import { Chunk, Effect, Layer, Option, RpcClient, RpcSerialization, Socket, Stream } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { TestRpcs } from './test-fixtures/rpc-schema.ts'

Vitest.describe('Durable Object WebSocket RPC', { timeout: 5000 }, () => {
  const port = process.env.LIVESTORE_SYNC_PORT

  const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  )

  // Direct HTTP RPC client tests
  Vitest.scopedLive(
    'should call ping method',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Ping({ message: 'Hello HTTP RPC' })
      expect(result).toEqual({ response: 'Pong: Hello HTTP RPC' })
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should call echo method',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Echo({ text: 'Echo' })
      expect(result).toEqual({ echo: 'Echo: Echo' })
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should call add method',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Add({ a: 15, b: 25 })
      expect(result).toEqual({ result: 40 })
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle RPC fail method',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const error = yield* client.Fail({ message: 'test http failure' }).pipe(Effect.exit)
      expect(error.toString()).toMatchInlineSnapshot(`
        "{
          "_id": "Exit",
          "_tag": "Failure",
          "cause": {
            "_id": "Cause",
            "_tag": "Fail",
            "failure": "RPC failure: test http failure"
          }
        }"
      `)
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle defect method',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const error = yield* client.Defect({ message: 'test http defect' }).pipe(Effect.exit)
      expect(error.toString()).toMatchInlineSnapshot(`
        "{
          "_id": "Exit",
          "_tag": "Failure",
          "cause": {
            "_id": "Cause",
            "_tag": "Die",
            "defect": "some defect: test http defect"
          }
        }"
      `)
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle streaming RPC via HTTP',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.Stream({}).pipe(
        Stream.take(4),
        Stream.map((c) => c.maybeNumber.pipe(Option.getOrUndefined)),
      )
      const chunks = yield* Stream.runCollect(stream)
      expect(Chunk.toReadonlyArray(chunks)).toEqual([1, 4, 9, 16]) // squares of 1,2,3,4
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle streaming RPC with error via HTTP',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.StreamError({ count: 5, errorAfter: 4 })
      const error = yield* Stream.runCollect(stream).pipe(Effect.exit)
      expect(error.toString()).toMatchInlineSnapshot(`
        "{
          "_id": "Exit",
          "_tag": "Failure",
          "cause": {
            "_id": "Cause",
            "_tag": "Fail",
            "failure": "Stream error after 4: got 9"
          }
        }"
      `)
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle streaming RPC with defect via HTTP',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.StreamDefect({ count: 4, defectAfter: 1 })
      const error = yield* Stream.runCollect(stream).pipe(Effect.exit)
      expect(error.toString()).toMatchInlineSnapshot(`
        "{
          "_id": "Exit",
          "_tag": "Failure",
          "cause": {
            "_id": "Cause",
            "_tag": "Die",
            "defect": "Stream defect after 1: got 4"
          }
        }"
      `)
    }, Effect.provide(ProtocolLive)),
  )

  Vitest.scopedLive(
    'should handle stream interruption via HTTP',
    Effect.fn(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.StreamInterruptible({ delay: 50, interruptAfterCount: 3 }).pipe(Stream.take(3))
      const chunks = yield* Stream.runCollect(stream)
      expect(Chunk.toReadonlyArray(chunks)).toEqual([1, 2, 3])
    }, Effect.provide(ProtocolLive)),
  )
})
