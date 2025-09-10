import {
  Chunk,
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Option,
  RpcClient,
  RpcSerialization,
  Socket,
  Stream,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { TestRpcs } from './test-fixtures/rpc-schema.ts'

const testTimeout = 60_000

const withWranglerTest = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    WranglerDevServerService.Default({
      cwd: `${import.meta.dirname}/test-fixtures`,
      // TODO remove showLogs again after debugging CI
      showLogs: true,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer, Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    ),
})

const ProtocolLive = Layer.suspend(() =>
  Effect.gen(function* () {
    const server = yield* WranglerDevServerService
    return RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`ws://localhost:${server.port}`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )
  }).pipe(Layer.unwrapEffect),
)

Vitest.describe('Durable Object WebSocket RPC', { timeout: testTimeout }, () => {
  // Direct HTTP RPC client tests
  Vitest.scopedLive('should call ping method', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Ping({ message: 'Hello HTTP RPC' })
      expect(result).toEqual({ response: 'Pong: Hello HTTP RPC' })
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should call echo method', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Echo({ text: 'Echo' })
      expect(result).toEqual({ echo: 'Echo: Echo' })
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should call add method', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const result = yield* client.Add({ a: 15, b: 25 })
      expect(result).toEqual({ result: 40 })
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle RPC fail method', (test) =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle defect method', (test) =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle streaming RPC via HTTP', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.Stream({}).pipe(
        Stream.take(4),
        Stream.map((c) => c.maybeNumber.pipe(Option.getOrUndefined)),
      )
      const chunks = yield* Stream.runCollect(stream)
      expect(Chunk.toReadonlyArray(chunks)).toEqual([1, 4, 9, 16]) // squares of 1,2,3,4
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle streaming RPC with error via HTTP', (test) =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle streaming RPC with defect via HTTP', (test) =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle stream interruption via HTTP', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      const stream = client.StreamInterruptible({ delay: 50, interruptAfterCount: 3 }).pipe(Stream.take(3))
      const chunks = yield* Stream.runCollect(stream)
      expect(Chunk.toReadonlyArray(chunks)).toEqual([1, 2, 3])
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )
})

Vitest.describe('Hibernation Tests', { timeout: 25000 }, () => {
  Vitest.scopedLive('should maintain RPC functionality after hibernation', (test) =>
    Effect.gen(function* () {
      console.log('🧪 Testing RPC server persistence across hibernation...')

      // Step 1: Create client and test initial functionality
      console.log('Step 1: Establishing initial connection and testing RPC methods...')
      const client = yield* RpcClient.make(TestRpcs)

      // Test various RPC methods to ensure full functionality
      console.log('Testing initial ping...')
      const ping1 = yield* client.Ping({ message: 'before hibernation' })
      expect(ping1).toEqual({ response: 'Pong: before hibernation' })
      console.log('✅ Initial ping successful')

      console.log('Testing initial echo...')
      const echo1 = yield* client.Echo({ text: 'hibernate test' })
      expect(echo1).toEqual({ echo: 'Echo: hibernate test' })
      console.log('✅ Initial echo successful')

      console.log('Testing initial add...')
      const add1 = yield* client.Add({ a: 10, b: 5 })
      expect(add1).toEqual({ result: 15 })
      console.log('✅ Initial add successful')

      // Step 2: Wait for hibernation (DO hibernates after 10 seconds of inactivity)
      // Reference: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
      // "When a Durable Object receives no events (like alarms) or messages for 10 seconds,
      // the Durable Object is evicted from memory to avoid unnecessary charges."
      console.log('Step 2: Waiting for hibernation (12 seconds)...')
      yield* Effect.sleep(12000)

      // Step 3: Test RPC functionality after hibernation
      console.log('Step 3: Testing RPC methods after hibernation...')

      console.log('Testing ping after hibernation...')
      const ping2 = yield* client.Ping({ message: 'after hibernation' })
      expect(ping2).toEqual({ response: 'Pong: after hibernation' })
      console.log('✅ Ping after hibernation successful')

      console.log('Testing echo after hibernation...')
      const echo2 = yield* client.Echo({ text: 'hibernation recovered' })
      expect(echo2).toEqual({ echo: 'Echo: hibernation recovered' })
      console.log('✅ Echo after hibernation successful')

      console.log('Testing add after hibernation...')
      const add2 = yield* client.Add({ a: 25, b: 15 })
      expect(add2).toEqual({ result: 40 })
      console.log('✅ Add after hibernation successful')

      // Step 4: Test streaming after hibernation
      console.log('Testing streaming after hibernation...')
      const stream = client.Stream({}).pipe(
        Stream.take(3),
        Stream.map((c) => c.maybeNumber.pipe(Option.getOrUndefined)),
      )
      const chunks = yield* Stream.runCollect(stream)
      expect(Chunk.toReadonlyArray(chunks)).toEqual([1, 4, 9]) // squares of 1,2,3
      console.log('✅ Streaming after hibernation successful')

      console.log('🎉 All RPC operations successful after hibernation!')
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )

  Vitest.scopedLive('should handle rapid operations after hibernation', (test) =>
    Effect.gen(function* () {
      console.log('🧪 Testing rapid operations after hibernation...')

      console.log('Step 1: Establishing initial connection...')
      const client = yield* RpcClient.make(TestRpcs)
      yield* client.Ping({ message: 'setup' })
      console.log('✅ Initial connection established')

      // Wait for hibernation - Durable Objects hibernate after 10 seconds of inactivity
      // Reference: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
      console.log('Step 2: Waiting for hibernation...')
      yield* Effect.sleep(12000)

      console.log('Step 3: Performing rapid operations after hibernation...')

      // Perform multiple rapid operations to stress-test hibernation recovery
      const operations = Array.from({ length: 5 }, (_, i) =>
        Effect.gen(function* () {
          const ping = yield* client.Ping({ message: `rapid-${i + 1}` })
          const add = yield* client.Add({ a: i + 1, b: i + 2 })
          const echo = yield* client.Echo({ text: `test-${i + 1}` })

          return {
            operation: i + 1,
            ping: ping.response,
            add: add.result,
            echo: echo.echo,
          }
        }),
      )

      const results = yield* Effect.all(operations, { concurrency: 5 })

      // Verify all operations succeeded with correct results
      expect(results).toHaveLength(5)
      results.forEach((result, i) => {
        expect(result.operation).toBe(i + 1)
        expect(result.ping).toBe(`Pong: rapid-${i + 1}`)
        expect(result.add).toBe(i + 1 + (i + 2)) // a + b
        expect(result.echo).toBe(`Echo: test-${i + 1}`)
      })

      console.log(
        '✅ All rapid operations successful:',
        results.map((r) => r.operation),
      )
      console.log('🎉 Rapid operations work correctly after hibernation!')
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )
})
