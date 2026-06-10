/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import { Effect, Layer, Option, RpcMessage, RpcServer, Schedule, Stream } from '@livestore/utils/effect'

import type * as CfTypes from '../../cf-types.ts'
import { setupDurableObjectWebSocketRpc } from '../ws-rpc-server.ts'
import { TestRpcs } from './rpc-schema.ts'

export interface Env {
  TEST_RPC_DO: DurableObjectNamespace<TestRpcDurableObject>
}

export class TestRpcDurableObject extends DurableObject<Env, unknown> {
  override __DURABLE_OBJECT_BRAND = 'TestRpcDurableObject' as never
  readonly webSocketRpcHandlers: ReturnType<typeof setupDurableObjectWebSocketRpc>

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    this.ctx = state

    const ServerLive = RpcServer.layer(TestRpcs).pipe(Layer.provide(makeHandlersLayer()))

    this.webSocketRpcHandlers = setupDurableObjectWebSocketRpc({
      doSelf: this as unknown as CfTypes.DurableObject,
      rpcLayer: ServerLive,
      webSocketMode: 'hibernate',
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === undefined || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()

    // Hibernate the server; DurableObjectState is stored on ctx
    this.ctx.acceptWebSocket(server)
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify(RpcMessage.constPing),
        JSON.stringify(RpcMessage.constPong),
      ),
    )

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.webSocketRpcHandlers.webSocketMessage(ws, message)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    return this.webSocketRpcHandlers.webSocketClose(ws, code, reason, wasClean)
  }
}

const makeHandlersLayer = () =>
  TestRpcs.toLayer({
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
    StreamInterruptible: ({ delay }) =>
      Stream.iterate(1, (n) => n + 1).pipe(
        Stream.map((n) => n),
        Stream.schedule(Schedule.spaced(delay)),
      ),
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const upgradeHeader = request.headers.get('Upgrade')
      if (upgradeHeader == null || upgradeHeader !== 'websocket') {
        return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
      }

      const serverDO = env.TEST_RPC_DO.get(env.TEST_RPC_DO.idFromName('test-server'))

      return serverDO.fetch(request)
    } catch (error) {
      return new Response(`Error: ${String(error)}`, { status: 500 })
    }
  },
}
