/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { layerProtocolDurableObject, toDurableObjectHandler } from '@livestore/common-cf'
import {
  Effect,
  HttpApp,
  Layer,
  Option,
  RpcClient,
  RpcSerialization,
  RpcServer,
  Schedule,
  Stream,
} from '@livestore/utils/effect'
import { TestRpcs } from './rpc-schema.ts'

export interface Env {
  TEST_RPC_DO: DurableObjectNamespace<TestRpcDurableObject>
}

export class TestRpcDurableObject extends DurableObject {
  __DURABLE_OBJECT_BRAND = 'TestRpcDurableObject' as never

  async rpc(payload: unknown): Promise<unknown> {
    const TestRpcsLive = TestRpcs.toLayer({
      Ping: ({ message }) => Effect.succeed({ response: `Pong: ${message}` }),
      Echo: ({ text }) => Effect.succeed({ echo: `Echo: ${text}` }),
      Add: ({ a, b }) => Effect.succeed({ result: a + b }),
      Defect: ({ message }) => Effect.die(`some defect: ${message}`),
      Fail: ({ message }) => Effect.fail(`RPC failure: ${message}`),
      Stream: () =>
        Stream.iterate(1, (n) => n + 1).pipe(
          Stream.map((n) => ({ maybeNumber: Option.some(n * n) })), // Stream squares: 1, 4, 9, 16, ...
          Stream.schedule(Schedule.spaced(10)),
          // TODO get rid of this - there currently seems to be a bug in the streaming interruption propagation
          // (might need help from @IMax153 on this)
          Stream.take(100),
        ),
      StreamError: ({ count, errorAfter }) =>
        Stream.range(1, count).pipe(
          Stream.map((n) => n * n),
          Stream.mapEffect((n) =>
            n > errorAfter ? Effect.fail(`Stream error after ${errorAfter}: got ${n}`) : Effect.succeed(n),
          ),
        ),
      StreamDefect: ({ count, defectAfter }) =>
        Stream.range(1, count).pipe(
          Stream.map((n) => n * n),
          Stream.mapEffect((n) =>
            n > defectAfter ? Effect.die(`Stream defect after ${defectAfter}: got ${n}`) : Effect.succeed(n),
          ),
        ),
      StreamInterruptible: ({ delay }) =>
        Stream.iterate(1, (n) => n + 1).pipe(
          Stream.map((n) => n),
          Stream.schedule(Schedule.spaced(delay)),
        ),
      StreamBugScenarioDoServer: () => Stream.make(1),
      StreamBugScenarioDoClient: () => Effect.die('never called'),
    })

    const result = await toDurableObjectHandler(TestRpcs, { layer: TestRpcsLive })(
      payload as Uint8Array<ArrayBuffer>,
    ).pipe(Effect.tapCauseLogPretty, Effect.runPromise)

    return result
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      // Handle HTTP RPC endpoint
      if (url.pathname === '/rpc') {
        // Get the test server DO instance
        const doId = env.TEST_RPC_DO.idFromName('test-server')
        const serverDO = env.TEST_RPC_DO.get(doId)
        const DoRpcProtocolLive = layerProtocolDurableObject({
          callRpc: (payload) => serverDO.rpc(payload),
          callerContext: { bindingName: 'TEST_RPC_DO', durableObjectId: doId.toString() },
        })

        return Effect.gen(function* () {
          const context = yield* Layer.build(DoRpcProtocolLive)

          const doRpcClient = yield* RpcClient.make(TestRpcs).pipe(Effect.provide(context))

          const handlersLayer = TestRpcs.toLayer({
            Ping: (msg) => doRpcClient.Ping(msg).pipe(Effect.orDie),
            Echo: (msg) => doRpcClient.Echo(msg).pipe(Effect.orDie),
            Add: (msg) => doRpcClient.Add(msg).pipe(Effect.orDie),
            Defect: (msg) => doRpcClient.Defect(msg).pipe(Effect.orDie),
            Fail: (msg) => doRpcClient.Fail(msg).pipe(Effect.orDie),
            Stream: (msg) => doRpcClient.Stream(msg).pipe(Stream.orDie),
            StreamError: (msg) => doRpcClient.StreamError(msg).pipe(Stream.mapError((e) => e.toString())),
            StreamDefect: (msg) => doRpcClient.StreamDefect(msg).pipe(Stream.orDie),
            StreamInterruptible: (msg) =>
              doRpcClient.StreamInterruptible(msg).pipe(Stream.take(msg.interruptAfterCount), Stream.orDie),
            StreamBugScenarioDoServer: () => Stream.die('never called'),
            StreamBugScenarioDoClient: (msg) =>
              doRpcClient.StreamBugScenarioDoServer(msg).pipe(
                Stream.tap(() => Effect.fail('doh')),
                // observed behaviour: `log1` is still logged
                Stream.tapErrorCause((cause) => Effect.log('log1', cause)),
                Stream.mapError((cause) => cause.toString()),
                // observed behaviour: after this error mapping `log2` is never logged
                Stream.tapErrorCause((cause) => Effect.log('log2', cause)),
                Stream.tapLogWithLabel('stream'),
                Stream.runCount,
                Effect.orDie,
                // observed behaviour: `log3` is also never logged
                Effect.tapErrorCause((cause) => Effect.log('log3', cause)),
              ),
          }).pipe(
            Layer.provideMerge(RpcServer.layerProtocolHttp({ path: '/rpc' })),
            Layer.provideMerge(RpcSerialization.layerJson),
          )

          // Create the HTTP RPC app
          const httpApp = RpcServer.toHttpApp(TestRpcs).pipe(Effect.provide(handlersLayer))

          // Run the app and convert to web handler
          const webHandler = yield* httpApp.pipe(Effect.map(HttpApp.toWebHandler))

          return yield* Effect.promise(() => webHandler(request))
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.scoped,
          Effect.withSpan('@livestore/common-cf/do-rpc/test-fixtures/worker:fetch'),
          // Effect.provide(ProtocolLive),
          Effect.runPromise,
        )
      }

      return new Response('Effect RPC Test Server\n\nEndpoints:\n- /rpc - HTTP RPC endpoint', {
        headers: { 'Content-Type': 'text/plain' },
      })
    } catch (error) {
      return new Response(`Error: ${error}`, { status: 500 })
    }
  },
}
