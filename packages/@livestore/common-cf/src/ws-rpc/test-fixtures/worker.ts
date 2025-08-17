/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { Effect, Layer, Mailbox, Option, RpcSerialization, RpcServer, Schedule, Stream } from '@livestore/utils/effect'
import { layerRpcServerWebsocket } from '../ws-rpc-server.ts'
import { TestRpcs } from './rpc-schema.ts'

export interface Env {
  TEST_RPC_DO: DurableObjectNamespace<TestRpcDurableObject>
}

export class TestRpcDurableObject extends DurableObject {
  __DURABLE_OBJECT_BRAND = 'TestRpcDurableObject' as never

  incomingQueue: Mailbox.Mailbox<Uint8Array<ArrayBufferLike> | string> | undefined

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === undefined || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()

    this.ctx.acceptWebSocket(server)

    Effect.gen(this, function* () {
      const incomingQueue = yield* Mailbox.make<Uint8Array<ArrayBufferLike> | string>()

      this.incomingQueue = incomingQueue

      const ProtocolLive = layerRpcServerWebsocket({
        send: (msg) => Effect.succeed(server.send(msg)),
        incomingQueue,
      }).pipe(Layer.provide(RpcSerialization.layerJson))

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
            // Limit stream to prevent infinite streaming over HTTP
            // TODO: remove this once Effect RPC (HTTP) supports stream cancellation
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
      })

      // Start the RPC server using RpcServer.layer
      const ServerLive = RpcServer.layer(TestRpcs).pipe(Layer.provide(TestRpcsLive), Layer.provide(ProtocolLive))

      // Launch the server layer
      yield* Layer.launch(ServerLive)
    }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    if (this.incomingQueue) {
      this.incomingQueue.offer(message as Uint8Array<ArrayBufferLike> | string).pipe(Effect.runPromise)
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    if (this.incomingQueue) {
      this.incomingQueue.shutdown.pipe(Effect.runPromise)
    }
  }

  webSocketError(_ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error)
    if (this.incomingQueue) {
      this.incomingQueue.shutdown.pipe(Effect.runPromise)
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
      }

      const serverDO = env.TEST_RPC_DO.get(env.TEST_RPC_DO.idFromName('test-server'))

      return serverDO.fetch(request)
    } catch (error) {
      return new Response(`Error: ${error}`, { status: 500 })
    }
  },
}
