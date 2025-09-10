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
    return RpcClient.layerProtocolHttp({
      url: `${server.url}/rpc`,
    }).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]))
  }).pipe(Layer.unwrapEffect),
)

/**
 * Test Architecture - Effect RPC via HTTP
 *
 *   ┌─────────────┐    HTTP RPC   ┌──────────────────┐
 *   │ Test Client │ ────────────▶ │ Worker (router)  │
 *   │  (vitest)   │               └──────────────────┘
 *   └─────────────┘                        │
 *                                          │ Durable Object RPC
 *                                          │
 *                                          ▼
 *                                 ┌──────────────────┐
 *                                 │   Server DO      │
 *                                 │ TestRpcs.toLayer │
 *                                 └──────────────────┘
 *
 * Test Path: Test → Worker /rpc → Server DO (HTTP RPC)
 */

Vitest.describe('Durable Object RPC', { timeout: testTimeout }, () => {
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
            "_tag": "Die",
            "defect": "RPC failure: test http failure"
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

  // TODO @IMax153
  Vitest.scopedLive.skip('should handle streaming RPC bug scenario', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)
      yield* client.StreamBugScenarioDoClient({})
      /*


      In `node_modules/.pnpm/@effect+rpc@0.68.4_@effect+platform@0.90.0_effect@3.17.7__effect@3.17.7/node_modules/@effect/rpc/dist/esm/RpcClient.js`:
      add the console log
      ```
      yield* Scope.addFinalizerExit(scope, exit => {
        if (!entries.has(id)) return Effect.void;
        entries.delete(id);
        console.log('addFinalizerExit', exit._tag, Cause.squash(exit.cause), rpc, payload)
        // ^^^^ added this console log
        return sendInterrupt(id, Exit.isFailure(exit) ? Array.from(Cause.interruptors(exit.cause)).flatMap(id => Array.from(FiberId.toSet(id))) : [], context);
      });
      ```

      Will generate output like:

      ```
      [wrangler:info] Ready on http://localhost:54539

      Wrangler dev server ready on port 54539
      writeResponse { _tag: 'Chunk', requestId: '0', values: [ 1 ] }

      timestamp=2025-08-27T08:10:02.114Z level=INFO fiber=#7 message=log1 cause="Error: doh"

      addFinalizerExit Failure doh {
        _tag: 'StreamBugScenarioDoServer',
        payloadSchema: [Function: TypeLiteralClass] {
          fields: {},
          records: [],
          make: [Function: make]
        },
        successSchema: [Function: DeclareClass] {
          typeParameters: [ [Function: Number$], [Function: Never] ],
          success: [Function: Number$],
          failure: [Function: Never]
        },
        errorSchema: [Function: Never],
        annotations: { _id: 'Context', services: [] },
        middlewares: Set(0) {},
        key: '@effect/rpc/Rpc/StreamBugScenarioDoServer'
      } {}

      Killing wrangler process...
      Killing wrangler process...
      ```

      */
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )
})
