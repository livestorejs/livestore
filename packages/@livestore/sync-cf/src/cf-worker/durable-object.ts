/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { EventSequenceNumber, State } from '@livestore/common/schema'
import { type CfTypes, setupDurableObjectWebSocketRpc } from '@livestore/common-cf'
import { CfDeclare } from '@livestore/common-cf/declare'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Logger, LogLevel, Predicate, RpcMessage, Schema, type Scope } from '@livestore/utils/effect'
import {
  type DurableObjectId,
  type Env,
  getRequestSearchParams,
  type MakeDurableObjectClassOptions,
  type RpcSubscription,
  type SyncBackendRpcInterface,
  WebSocketAttachmentSchema,
} from './shared.ts'

export type { CfTypes } from '@livestore/common-cf'

import { contextTable, eventlogTable } from './sqlite.ts'
import { makeStorage, type SyncStorage } from './sync-storage.ts'
import { createDoRpcHandler } from './transport/do-rpc.ts'
import { createHttpRpcHandler } from './transport/http-rpc.ts'
import { makeRpcServer } from './transport/ws.ts'

// NOTE We need to redeclare runtime types here to avoid type conflicts with the lib.dom Response type.
declare class Request extends CfDeclare.Request {}
declare class Response extends CfDeclare.Response {}
declare class WebSocketPair extends CfDeclare.WebSocketPair {}
declare class WebSocketRequestResponsePair extends CfDeclare.WebSocketRequestResponsePair {}

const DurableObjectBase = DurableObject as any as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

// RPC interface for sync backend - allows client DOs to subscribe/unsubscribe
// Moved to protocol-durable-object.ts

// RPC interface that sync backend can call on client DOs
export interface ClientDOInterface extends CfTypes.Rpc.DurableObjectBranded {
  // onPullNotification(message: SyncMessage.PullRes): Promise<void>
  // ping(): Promise<{ status: 'ok'; timestamp: number }>
}

const PropsSchema = Schema.parseJson(
  Schema.Struct({
    storeId: Schema.String,

    // TODO
    currentHead: Schema.optional(EventSequenceNumber.GlobalEventSequenceNumber),
  }),
)

// Type aliases needed to avoid TS bug https://github.com/microsoft/TypeScript/issues/55021
export type DoState = CfTypes.DurableObjectState
export type DoObject = CfTypes.DurableObject

export type MakeDurableObjectClass = (options?: MakeDurableObjectClassOptions) => {
  new (ctx: DoState, env: Env): DoObject
}

// export type MakeDurableObjectClass = (options?: MakeDurableObjectClassOptions) => {
//   new (ctx: CfTypes.DurableObjectState, env: Env): CfTypes.DurableObject
// }

/**
 * Creates a Durable Object class for handling WebSocket-based sync.
 * A sync durable object is uniquely scoped to a specific `storeId`.
 * 
 * The sync DO supports 3 transport modes:
 * - HTTP JSON-RPC
 * - WebSocket
 * - Durable Object RPC calls (only works in combination with `@livestore/adapter-cf`)
 *
 * Example:
 * 
 * ```ts
 * // In your Cloudflare Worker file
 * import { makeDurableObject } from '@livestore/sync-cf/cf-worker'
 *
 * export class SyncBackendDO extends makeDurableObject({
 *   onPush: async (message) => {
 *     console.log('onPush', message.batch)
 *   },
 *   onPull: async (message) => {
 *     console.log('onPull', message)
 *   },
 * }) {}
 * ```
 *
 * `wrangler.toml`
 * ```toml
 * [[durable_objects.bindings]]
 * name = "SYNC_BACKEND_DO"
 * class_name = "SyncBackendDO"

 * [[migrations]]
 * tag = "v1"
 * new_sqlite_classes = ["SyncBackendDO"]
 * ```
 */
export const makeDurableObject: MakeDurableObjectClass = (options) => {
  return class SyncBackendDOBase extends DurableObjectBase implements SyncBackendRpcInterface {
    __DURABLE_OBJECT_BRAND = 'SyncBackendDOBase' as never
    ctx: CfTypes.DurableObjectState
    env: Env

    // Cached value
    props: typeof PropsSchema.Type | undefined

    constructor(ctx: CfTypes.DurableObjectState, env: Env) {
      super(ctx, env)
      this.ctx = ctx
      this.env = env

      const ServerLive = makeRpcServer({
        options,
        ctx: this.ctx,
        env: this.env,
        currentHeadRef: this.currentHeadRef,
        rpcSubscriptions: this.rpcSubscriptions,
        pushSemaphore: this.pushSemaphore,
      })

      // This registers the `webSocketMessage` and `webSocketClose` handlers
      setupDurableObjectWebSocketRpc({
        doSelf: this,
        rpcLayer: ServerLive,
        webSocketMode: 'hibernate',
        // See `pull.ts` for more details how `pull` Effect RPC requests streams are handled
        // in combination with DO hibernation
        onMessage: (request, ws) => {
          if (request._tag === 'Request' && request.tag === 'SyncWsRpc.Pull') {
            // Is Pull request: add requestId to pullRequestIds
            const attachment = ws.deserializeAttachment()
            const { pullRequestIds, ...rest } = Schema.decodeSync(WebSocketAttachmentSchema)(attachment)
            ws.serializeAttachment(
              Schema.encodeSync(WebSocketAttachmentSchema)({
                ...rest,
                pullRequestIds: [...pullRequestIds, request.id],
              }),
            )
          } else if (request._tag === 'Interrupt') {
            // Is Interrupt request: remove requestId from pullRequestIds
            const attachment = ws.deserializeAttachment()
            const { pullRequestIds, ...rest } = Schema.decodeSync(WebSocketAttachmentSchema)(attachment)
            ws.serializeAttachment(
              Schema.encodeSync(WebSocketAttachmentSchema)({
                ...rest,
                pullRequestIds: pullRequestIds.filter((id) => id !== request.requestId),
              }),
            )
          }
        },
      })
    }

    /** Needed to prevent concurrent pushes */
    private pushSemaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)

    // TODO move to `props`
    private currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' } = {
      current: 'uninitialized',
    }

    /** RPC subscription storage */
    private rpcSubscriptions = new Map<DurableObjectId, RpcSubscription>()

    fetch = async (request: Request): Promise<Response> =>
      Effect.gen(this, function* () {
        const url = new URL(request.url)

        if (url.pathname.endsWith('/http-rpc')) {
          return yield* this.handleHttp(request)
        }

        if (url.pathname.endsWith('/sync')) {
          const { storeId, payload } = getRequestSearchParams(request)
          const storage = makeStorage(this.ctx, this.env, storeId)

          this.getProps(request)

          const { 0: client, 1: server } = new WebSocketPair()

          // Since we're using websocket hibernation, we need to remember the storeId for subsequent `webSocketMessage` calls
          server.serializeAttachment(
            Schema.encodeSync(WebSocketAttachmentSchema)({ storeId, payload, pullRequestIds: [] }),
          )

          // See https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server

          this.ctx.acceptWebSocket(server)

          // Ping requests are sent by Effect RPC internally
          this.ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair(
              JSON.stringify(RpcMessage.constPing),
              JSON.stringify(RpcMessage.constPong),
            ),
          )

          this.initializeStorage(storage)

          return new Response(null, {
            status: 101,
            webSocket: client,
          })
        }

        console.error('Invalid path', request.url)

        return new Response('Invalid path', {
          status: 400,
          statusText: 'Bad Request',
        })
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.catchAllCause((cause) =>
          Effect.succeed(new Response('Error', { status: 500, statusText: cause.toString() })),
        ),
        Effect.withSpan('@livestore/sync-cf:durable-object:fetch'),
        this.runEffectAsPromise,
      )

    /**
     * Handles HTTP RPC calls
     *
     * Requires the `enable_request_signal` compatibility flag to properly support `pull` streaming responses
     */
    handleHttp = (request: Request) =>
      createHttpRpcHandler({
        ctx: this.ctx,
        makeStorage: (storeId) => {
          // ensure storage is initialized
          this.getProps({ storeId })
          return makeStorage(this.ctx, this.env, storeId)
        },
        doOptions: options,
        pushSemaphore: this.pushSemaphore,
        rpcSubscriptions: this.rpcSubscriptions,
        currentHeadRef: this.currentHeadRef,
        request,
      }).pipe(Effect.withSpan('@livestore/sync-cf:durable-object:handleHttp'))

    /**
     * Handles DO <-> DO RPC calls
     */
    async rpc(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | CfTypes.ReadableStream> {
      return createDoRpcHandler({
        ctx: this.ctx,
        env: this.env,
        doOptions: options,
        pushSemaphore: this.pushSemaphore,
        rpcSubscriptions: this.rpcSubscriptions,
        currentHeadRef: this.currentHeadRef,
        payload,
        ensureProps: (storeId) => this.getProps({ storeId }),
      }).pipe(Effect.withSpan('@livestore/sync-cf:durable-object:rpc'), this.runEffectAsPromise)
    }

    private initializeStorage = (storage: SyncStorage) => {
      {
        const colSpec = State.SQLite.makeColumnSpec(eventlogTable.sqliteDef.ast)
        this.env.DB.exec(`CREATE TABLE IF NOT EXISTS ${storage.dbName} (${colSpec}) strict`)
      }
      {
        const colSpec = State.SQLite.makeColumnSpec(contextTable.sqliteDef.ast)
        this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${contextTable.sqliteDef.name} (${colSpec}) strict`)
      }
    }

    private getProps = (request: CfTypes.Request | { storeId: string }): typeof PropsSchema.Type => {
      if (this.props !== undefined) {
        return this.props
      }

      const getStoreId = (request: CfTypes.Request | { storeId: string }) => {
        if (Predicate.hasProperty(request, 'url')) {
          const url = new URL(request.url)
          return (
            url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided in request URL search params`)
          )
        }
        return request.storeId
      }

      const storeId = getStoreId(request)
      const storage = makeStorage(this.ctx, this.env, storeId)

      this.initializeStorage(storage)

      const props = { storeId, currentHead: EventSequenceNumber.ROOT.global }

      this.props = props

      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO ${contextTable.sqliteDef.name} (storeId, currentHead) VALUES (?, ?)`,
        props.storeId,
        props.currentHead,
      )

      return props
    }

    private runEffectAsPromise = <T, E = never>(effect: Effect.Effect<T, E, Scope.Scope>): Promise<T> =>
      effect.pipe(
        Effect.tapCauseLogPretty,
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.provide(
          Logger.prettyWithThread('SyncDo', {
            // NOTE We need to set the mode explicity as there's currently a bug https://github.com/Effect-TS/effect/issues/5398
            mode: 'tty',
          }),
        ),
        Effect.scoped,
        Effect.runPromise,
      )
  }
}
