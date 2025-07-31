/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { layerProtocolDurableObject, toDurableObjectHandler } from '@livestore/common-cf'
import { Chunk, Effect, Option, Rpc, RpcClient, RpcGroup, Schedule, Schema, Stream } from '@livestore/utils/effect'

export class TestRpcs extends RpcGroup.make(
  Rpc.make('Ping', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ response: Schema.String }),
  }),
  Rpc.make('Echo', {
    payload: Schema.Struct({ text: Schema.String }),
    success: Schema.Struct({ echo: Schema.String }),
  }),
  Rpc.make('Add', {
    payload: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
    success: Schema.Struct({ result: Schema.Number }),
  }),
  Rpc.make('Defect', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ never: Schema.String }),
  }),
  Rpc.make('Fail', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ never: Schema.String }),
    error: Schema.String,
  }),
  Rpc.make('Stream', {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      maybeNumber: Schema.Option(Schema.Number),
    }),
    stream: true,
  }),
  Rpc.make('StreamError', {
    payload: Schema.Struct({ count: Schema.Number, errorAfter: Schema.Number }),
    success: Schema.Number,
    error: Schema.String,
    stream: true,
  }),
  Rpc.make('StreamDefect', {
    payload: Schema.Struct({ count: Schema.Number, defectAfter: Schema.Number }),
    success: Schema.Number,
    stream: true,
  }),
) {}

export interface Env {
  TEST_RPC_DO: DurableObjectNamespace<TestRpcDurableObject>
  TEST_RPC_CLIENT_DO: DurableObjectNamespace
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
    })

    const result = await toDurableObjectHandler(TestRpcs, { layer: TestRpcsLive })(payload as Uint8Array)
    return result
  }
}

export class TestRpcClientDO extends DurableObject {
  __DURABLE_OBJECT_BRAND = 'TestRpcClientDO' as never
  readonly env: Env

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (url.pathname === '/call-server') {
        const method = url.searchParams.get('method')
        const serverDO = this.env.TEST_RPC_DO.get(this.env.TEST_RPC_DO.idFromName('test-server'))

        // Create protocol layer for DO RPC communication
        const ProtocolLive = layerProtocolDurableObject((payload) => serverDO.rpc(payload))

        // Use idiomatic Effect RPC client pattern from README
        const program = Effect.gen(function* () {
          const client = yield* RpcClient.make(TestRpcs)

          // Call RPC methods using clean API
          switch (method) {
            case 'ping': {
              const message = url.searchParams.get('message') || 'Hello'
              return yield* client.Ping({ message })
            }
            case 'echo': {
              const text = url.searchParams.get('text') || 'Hello World'
              return yield* client.Echo({ text })
            }
            case 'add': {
              const a = Number.parseInt(url.searchParams.get('a') || '5')
              const b = Number.parseInt(url.searchParams.get('b') || '3')
              return yield* client.Add({ a, b })
            }
            case 'defect': {
              const message = url.searchParams.get('message') || 'test defect'
              return yield* client.Defect({ message })
            }
            case 'fail': {
              const message = url.searchParams.get('message') || 'test failure'
              return yield* client.Fail({ message })
            }
            case 'stream': {
              const count = Number.parseInt(url.searchParams.get('count') || '4')
              // Get the stream from the client and collect it
              const stream = client.Stream({}).pipe(
                Stream.take(count),
                Stream.map((c) => c.maybeNumber.pipe(Option.getOrUndefined)),
              )
              const chunks = yield* Stream.runCollect(stream)
              return { streamValues: Chunk.toReadonlyArray(chunks) }
            }
            case 'stream-error': {
              const count = Number.parseInt(url.searchParams.get('count') || '5')
              const errorAfter = Number.parseInt(url.searchParams.get('errorAfter') || '2')
              const stream = client.StreamError({ count, errorAfter })
              const chunks = yield* Stream.runCollect(stream)
              return { streamValues: Chunk.toReadonlyArray(chunks) }
            }
            case 'stream-defect': {
              const count = Number.parseInt(url.searchParams.get('count') || '5')
              const defectAfter = Number.parseInt(url.searchParams.get('defectAfter') || '2')
              const stream = client.StreamDefect({ count, defectAfter })
              const chunks = yield* Stream.runCollect(stream)
              return { streamValues: Chunk.toReadonlyArray(chunks) }
            }
            default:
              return yield* Effect.fail(new Error(`Unknown method: ${method}`))
          }
        }).pipe(Effect.scoped)

        const result = await program.pipe(Effect.provide(ProtocolLive), Effect.runPromise)

        return new Response(JSON.stringify({ success: true, result }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    } catch (error) {
      console.error('Stream RPC Error:', error)
      return new Response(JSON.stringify({ success: false, error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      // Idiomatic Effect RPC client testing
      if (url.pathname === '/test-rpc-client') {
        const clientDO = env.TEST_RPC_CLIENT_DO.get(env.TEST_RPC_CLIENT_DO.idFromName('test-client'))
        const method = url.searchParams.get('method') ?? 'ping'
        const clientUrl = new URL('/call-server', request.url)
        clientUrl.searchParams.set('method', method)

        // Forward parameters
        for (const [key, value] of url.searchParams) {
          if (key !== 'method') {
            clientUrl.searchParams.set(key, value)
          }
        }

        return clientDO.fetch(clientUrl.toString())
      }

      return new Response(
        'Idiomatic Effect RPC Test\n\nEndpoints:\n- /test-rpc-client?method=ping|echo|add|defect|fail|stream|stream-error|stream-defect',
        {
          headers: { 'Content-Type': 'text/plain' },
        },
      )
    } catch (error) {
      return new Response(`Error: ${error}`, { status: 500 })
    }
  },
}
