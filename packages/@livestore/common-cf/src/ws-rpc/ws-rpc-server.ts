/**
 * @fileoverview WebSocket RPC server implementation for Cloudflare Durable Objects.
 *
 * This module provides functionality to set up WebSocket-based RPC communication
 * on Cloudflare Durable Objects with hibernation support. It handles the complete
 * lifecycle of WebSocket RPC servers, including message routing, protocol handling,
 * and automatic recovery after hibernation cycles.
 *
 * Key features:
 * - Hibernation-compatible WebSocket handling
 * - Automatic RPC server lifecycle management
 * - Effect-based RPC protocol implementation
 * - Cost optimization through hibernation support
 *
 * @see {@link https://developers.cloudflare.com/durable-objects/best-practices/websockets/ Cloudflare WebSocket Best Practices}
 */

import { notYetImplemented, omitUndefineds } from '@livestore/utils'
import {
  constVoid,
  Effect,
  Exit,
  Layer,
  Logger,
  LogLevel,
  Mailbox,
  RpcMessage,
  RpcSerialization,
  RpcServer,
  Scope,
  Stream,
} from '@livestore/utils/effect'
import type * as CfTypes from '../cf-types.ts'

/**
 * Configuration options for setting up WebSocket RPC on a Durable Object.
 */
export interface DurableObjectWebSocketRpcConfig {
  /** The Durable Object instance to configure */
  doSelf: CfTypes.DurableObject
  /**
   * WebSocket handling mode:
   * - 'hibernate': Use hibernation-compatible WebSocket handling (recommended for cost optimization)
   * - 'accept': Use traditional WebSocket handling (not yet implemented)
   */
  webSocketMode: 'hibernate' | 'accept'
  /** Effect RPC layer that defines the available RPC methods and handlers */
  rpcLayer: Layer.Layer<never, never, RpcServer.Protocol>
  /** Function to get access to incoming requests */
  onMessage?: (msg: RpcMessage.FromClientEncoded, ws: CfTypes.WebSocket) => void
  mainLayer?: Layer.Layer<never, never, never>
}

/**
 * Sets up WebSocket RPC functionality on a Cloudflare Durable Object with hibernation support.
 *
 * Configures hibernation-compatible WebSocket RPC communication using Effect's type-safe RPC framework.
 * Hibernation reduces costs by evicting DOs from memory after 10 seconds of inactivity while keeping
 * WebSocket connections alive and automatically restoring RPC server state when the DO wakes up.
 *
 * **Effect RPC Integration:**
 * - Uses Effect's RPC framework for type-safe client-server communication
 * - Supports streaming responses, error handling, and automatic serialization
 * - Handlers are defined as Effect operations for composable, testable logic
 * - Provides automatic message routing and protocol management
 *
 * **Hibernation Benefits:**
 * - Cost optimization: DOs hibernate after 10 seconds of inactivity
 * - Persistent connections: WebSocket connections survive hibernation
 * - Automatic recovery: RPC infrastructure restores seamlessly on wake-up
 *
 * **Usage Example:**
 * ```typescript
 * export class MyDurableObject extends DurableObject {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     const handlersLayer = MyRpcs.toLayer({
 *       Ping: ({ message }) => Effect.succeed({ response: `Pong: ${message}` }),
 *       // ... other RPC handlers
 *     })
 *
 *     const ServerLive = RpcServer.layer(MyRpcs).pipe(Layer.provide(handlersLayer))
 *
 *     setupDurableObjectWebSocketRpc({
 *       doSelf: this,
 *       rpcLayer: ServerLive,
 *       webSocketMode: 'hibernate',
 *     })
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     // Handle WebSocket upgrades
 *     const { 0: client, 1: server } = new WebSocketPair()
 *     this.ctx.acceptWebSocket(server)
 *     return new Response(null, { status: 101, webSocket: client })
 *   }
 * }
 * ```
 *
 * **What this function does:**
 * 1. Sets up WebSocket message routing and RPC protocol handling
 * 2. Configures hibernation-compatible WebSocket handlers (`webSocketMessage`, `webSocketClose`)
 * 3. Manages RPC server lifecycle (start, stop, cleanup)
 * 4. Handles incoming queue management for message processing
 * 5. Provides automatic recovery after hibernation cycles
 *
 * @param config Configuration for WebSocket RPC setup
 * @returns Configured WebSocket handler functions
 *
 * @see {@link https://developers.cloudflare.com/durable-objects/best-practices/websockets/ Cloudflare WebSocket Best Practices}
 * @see {@link https://effect-ts.github.io/effect/docs/rpc Effect RPC Documentation}
 */
export const setupDurableObjectWebSocketRpc = ({
  doSelf,
  rpcLayer,
  webSocketMode,
  onMessage,
  mainLayer,
}: DurableObjectWebSocketRpcConfig) => {
  if (webSocketMode === 'accept') {
    return notYetImplemented(`WebSocket mode 'accept' is not yet implemented`)
  }

  const serverCtxMap = new Map<
    CfTypes.WebSocket,
    {
      scope: Scope.CloseableScope
      onMessage: (message: string | ArrayBuffer) => Promise<void>
    }
  >()

  const launchServer = (ws: CfTypes.WebSocket) =>
    Effect.gen(function* () {
      if (serverCtxMap.has(ws)) {
        return serverCtxMap.get(ws)!
      }

      yield* Effect.logDebug(`Launching WebSocket Effect RPC server`)

      const scope = yield* Scope.make()

      const incomingQueue = yield* Mailbox.make<Uint8Array<ArrayBufferLike> | string>()

      yield* Scope.addFinalizer(scope, incomingQueue.shutdown)

      const ProtocolLive = layerRpcServerWebsocket({
        ws,
        incomingQueue,
        ...omitUndefineds({ onMessage }),
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const ServerLive = rpcLayer.pipe(Layer.provide(ProtocolLive))

      yield* Layer.launch(ServerLive).pipe(Effect.tapCauseLogPretty, Effect.forkIn(scope))

      const runtime = yield* Effect.runtime()

      const ctx = {
        scope,
        onMessage: (message: string | ArrayBuffer) =>
          incomingQueue
            .offer(message as Uint8Array<ArrayBufferLike> | string)
            .pipe(
              Effect.asVoid,
              Effect.withSpan('ws-rpc-server/onMessage', { root: true }),
              Effect.provide(runtime),
              Effect.runPromise,
            ),
      }

      serverCtxMap.set(ws, ctx)

      return ctx
    }).pipe(
      Effect.tapCauseLogPretty,
      Logger.withMinimumLogLevel(LogLevel.Debug), // Useful for debugging
      Effect.provide(Layer.mergeAll(Logger.consoleWithThread('ws-rpc-server'), mainLayer ?? Layer.empty)),
      Effect.withSpan('effect-ws-rpc-server'),
      Effect.runPromise,
    )

  const webSocketMessage: CfTypes.DurableObject['webSocketMessage'] = async (ws, message) => {
    // Lightweight diagnostics for message handling lifecycle
    try {
      // Avoid logging full payloads to keep logs readable
      console.log('[ws-rpc-server] webSocketMessage received', {
        hasCtx: serverCtxMap.has(ws),
        type: typeof message,
        size: typeof message === 'string' ? message.length : ((message as any)?.byteLength ?? 0),
      })
    } catch {}
    const { onMessage } = await launchServer(ws)

    await onMessage(message)
  }

  const webSocketClose: CfTypes.DurableObject['webSocketClose'] = async (ws, _code, _reason, _wasClean) => {
    const ctx = serverCtxMap.get(ws)
    try {
      console.log('[ws-rpc-server] webSocketClose', { hadCtx: Boolean(ctx) })
    } catch {}
    if (ctx) {
      await Scope.close(ctx.scope, Exit.void).pipe(Effect.runPromise)
      serverCtxMap.delete(ws)
    }
  }

  doSelf.webSocketMessage = webSocketMessage.bind(doSelf)
  doSelf.webSocketClose = webSocketClose.bind(doSelf)

  return {
    webSocketMessage,
    webSocketClose,
  }
}

/**
 * Arguments for creating a WebSocket RPC server protocol layer.
 */
export interface WsRpcServerArgs {
  ws: CfTypes.WebSocket
  onMessage?: (message: RpcMessage.FromClientEncoded, ws: CfTypes.WebSocket) => void
  /** Mailbox queue for receiving incoming messages from the WebSocket */
  incomingQueue: Mailbox.Mailbox<Uint8Array<ArrayBufferLike> | string>
}

/**
 * Creates an RPC server protocol layer for WebSocket communication.
 *
 * This layer handles the low-level WebSocket protocol details for RPC communication,
 * including message serialization, routing, and error handling.
 *
 * @param args Configuration for WebSocket RPC protocol
 * @returns Effect layer that provides RPC server protocol functionality
 *
 * @internal This is typically used internally by `setupDurableObjectWebSocketRpc`
 */
export const layerRpcServerWebsocket = (args: WsRpcServerArgs) =>
  Layer.scoped(RpcServer.Protocol, makeSocketProtocol(args))

/**
 * Creates the low-level RPC protocol implementation for WebSocket communication.
 *
 * Handles message parsing, encoding, streaming, and client lifecycle management
 * for WebSocket-based RPC communication in Durable Objects.
 *
 * @param args WebSocket RPC server configuration
 * @returns Effect that provides the RPC protocol implementation
 *
 * @internal Used internally by `layerRpcServerWebsocket`
 */
const makeSocketProtocol = ({ incomingQueue, ws, onMessage }: WsRpcServerArgs) =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const disconnects = yield* Mailbox.make<number>()

    const writeRaw = (msg: Uint8Array<ArrayBufferLike> | string) => Effect.succeed(ws.send(msg))

    let writeRequest!: (clientId: number, message: RpcMessage.FromClientEncoded) => Effect.Effect<void>

    const parser = serialization.unsafeMake()
    const id = 0

    const write = (response: RpcMessage.FromServerEncoded) => {
      try {
        const encoded = parser.encode(response)
        if (encoded === undefined) {
          return Effect.void
        }
        return Effect.orDie(writeRaw(encoded))
      } catch (cause) {
        return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!))
      }
    }

    const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
      writeRequest = writeRequest_

      // Start processing messages now that writeRequest is available
      const startProcessing = Mailbox.toStream(incomingQueue).pipe(
        Stream.tap((data) => {
          try {
            const decoded = parser.decode(data) as ReadonlyArray<RpcMessage.FromClientEncoded>
            if (decoded.length === 0) return Effect.void
            let i = 0
            return Effect.whileLoop({
              while: () => i < decoded.length,
              body: () => {
                const request = decoded[i++]!
                if (onMessage) {
                  onMessage(request, ws)
                }
                return writeRequest(id, request)
              },
              step: constVoid,
            })
          } catch (cause) {
            return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!))
          }
        }),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.fork,
      )

      // Start the message processing
      return Effect.map(startProcessing, () => ({
        disconnects,
        send: (_clientId, response) => Effect.orDie(write(response)),
        end(_clientId) {
          return Effect.void
        },
        // Always just one client
        clientIds: Effect.sync(() => [id]),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      }))
    })

    return protocol
  })
