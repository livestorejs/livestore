/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { EventSequenceNumber, State } from '@livestore/common/schema'
import { type CfTypes, setupDurableObjectWebSocketRpc } from '@livestore/common-cf'
import { CfDeclare } from '@livestore/common-cf/declare'
import { shouldNeverHappen } from '@livestore/utils'
import {
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Otlp,
  Predicate,
  RpcMessage,
  Schema,
  type Scope,
} from '@livestore/utils/effect'
import {
  type DurableObjectId,
  type Env,
  getSyncRequestSearchParams,
  type MakeDurableObjectClassOptions,
  type RpcSubscription,
  type SyncBackendRpcInterface,
  WebSocketAttachmentSchema,
} from '../shared.ts'

import { contextTable, eventlogTable } from './sqlite.ts'
import { makeStorage } from './sync-storage.ts'
import { createDoRpcHandler } from './transport/do-rpc-server.ts'
import { createHttpRpcHandler } from './transport/http-rpc-server.ts'
import { makeRpcServer } from './transport/ws-rpc-server.ts'

// NOTE We need to redeclare runtime types here to avoid type conflicts with the lib.dom Response type.
// TODO get rid of those once CF fixed their type mismatch in the worker types
declare class Request extends CfDeclare.Request {}
declare class Response extends CfDeclare.Response {}
declare class WebSocketPair extends CfDeclare.WebSocketPair {}
declare class WebSocketRequestResponsePair extends CfDeclare.WebSocketRequestResponsePair {}

const DurableObjectBase = DurableObject as any as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

// Type aliases needed to avoid TS bug https://github.com/microsoft/TypeScript/issues/55021
export type DoState = CfTypes.DurableObjectState
export type DoObject<T> = CfTypes.DurableObject & T

export type MakeDurableObjectClass = (options?: MakeDurableObjectClassOptions) => {
  new (ctx: DoState, env: Env): DoObject<SyncBackendRpcInterface>
}

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
  const enabledTransports = options?.enabledTransports ?? new Set(['http', 'ws', 'do-rpc'])

  const Logging = Logger.consoleWithThread('SyncDo')

  const Observability = options?.otel?.baseUrl
    ? Otlp.layer({
        baseUrl: options.otel.baseUrl,
        tracerExportInterval: 50,
        resource: {
          serviceName: options.otel.serviceName ?? 'sync-cf-do',
        },
      }).pipe(Layer.provide(FetchHttpClient.layer))
    : Layer.empty

  return class SyncBackendDOBase extends DurableObjectBase implements SyncBackendRpcInterface {
    __DURABLE_OBJECT_BRAND = 'SyncBackendDOBase' as never
    ctx: CfTypes.DurableObjectState
    env: Env

    // Cached value
    private storageCache: typeof StorageCacheSchema.Type | undefined

    // TODO move to `storageCache`
    private currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' } = {
      current: 'uninitialized',
    }

    // TODO refactor
    /** RPC subscription storage */
    private rpcSubscriptions = new Map<DurableObjectId, RpcSubscription>()

    constructor(ctx: CfTypes.DurableObjectState, env: Env) {
      super(ctx, env)
      this.ctx = ctx
      this.env = env

      const WebSocketRpcServerLive = makeRpcServer({
        options,
        ctx: this.ctx,
        env: this.env,
        currentHeadRef: this.currentHeadRef,
        rpcSubscriptions: this.rpcSubscriptions,
      })

      // This registers the `webSocketMessage` and `webSocketClose` handlers
      if (enabledTransports.has('ws')) {
        setupDurableObjectWebSocketRpc({
          doSelf: this,
          rpcLayer: WebSocketRpcServerLive,
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
              // TODO also emit `Exit` stream RPC message
            }
          },
          mainLayer: Observability,
        })
      }
    }

    fetch = async (request: Request): Promise<Response> =>
      Effect.gen(this, function* () {
        const requestParamsResult = getSyncRequestSearchParams(request)
        if (requestParamsResult._tag === 'None') {
          throw new Error('No search params found in request URL')
        }

        const { storeId, payload, transport } = requestParamsResult.value

        if (enabledTransports.has(transport) === false) {
          throw new Error(`Transport ${transport} is not enabled (based on \`options.enabledTransports\`)`)
        }

        if (transport === 'http') {
          return yield* this.handleHttp(request)
        }

        if (transport === 'ws') {
          yield* this.getStorageCache(request)

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
        Effect.tapCauseLogPretty, // Also log errors to console before catching them
        Effect.catchAllCause((cause) =>
          Effect.succeed(new Response('Error', { status: 500, statusText: cause.toString() })),
        ),
        Effect.withSpan('@livestore/sync-cf:durable-object:fetch'),
        this.runEffectAsPromise,
      )

    /**
     * Handles DO <-> DO RPC calls
     */
    async rpc(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | CfTypes.ReadableStream> {
      if (enabledTransports.has('do-rpc') === false) {
        throw new Error('Do RPC transport is not enabled (based on `options.enabledTransports`)')
      }

      return createDoRpcHandler({
        ctx: this.ctx,
        env: this.env,
        doOptions: options,
        rpcSubscriptions: this.rpcSubscriptions,
        currentHeadRef: this.currentHeadRef,
        payload,
        ensureStorageCache: (storeId) => this.getStorageCache({ storeId }),
      }).pipe(Effect.withSpan('@livestore/sync-cf:durable-object:rpc'), this.runEffectAsPromise)
    }

    /**
     * Handles HTTP RPC calls
     *
     * Requires the `enable_request_signal` compatibility flag to properly support `pull` streaming responses
     */
    private handleHttp = (request: Request) =>
      createHttpRpcHandler({
        ctx: this.ctx,
        env: this.env,
        makeStorage: (storeId) =>
          Effect.gen(this, function* () {
            // ensure storage is initialized
            yield* this.getStorageCache({ storeId })
            return makeStorage(this.ctx, this.env, storeId)
          }),
        doOptions: options,
        rpcSubscriptions: this.rpcSubscriptions,
        currentHeadRef: this.currentHeadRef,
        request,
      }).pipe(Effect.withSpan('@livestore/sync-cf:durable-object:handleHttp'))

    // TODO refactor with Effect layer
    private getStorageCache = (
      request: CfTypes.Request | { storeId: string },
    ): Effect.Effect<typeof StorageCacheSchema.Type> =>
      Effect.gen(this, function* () {
        if (this.storageCache !== undefined) {
          return this.storageCache
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

        // Initialize database tables
        {
          const colSpec = State.SQLite.makeColumnSpec(eventlogTable.sqliteDef.ast)
          // D1 database is async, so we need to use a promise
          yield* Effect.promise(() =>
            this.env.DB.exec(`CREATE TABLE IF NOT EXISTS "${storage.dbName}" (${colSpec}) strict`),
          )
        }
        {
          const colSpec = State.SQLite.makeColumnSpec(contextTable.sqliteDef.ast)
          this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS "${contextTable.sqliteDef.name}" (${colSpec}) strict`)
        }

        const storageCache = { storeId, currentHead: EventSequenceNumber.ROOT.global }

        this.storageCache = storageCache

        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO "${contextTable.sqliteDef.name}" (storeId, currentHead) VALUES (?, ?)`,
          storageCache.storeId,
          storageCache.currentHead,
        )

        return storageCache
      }).pipe(Effect.withSpan('@livestore/sync-cf:durable-object:getStorageCache'))

    private runEffectAsPromise = <T, E = never>(effect: Effect.Effect<T, E, Scope.Scope>): Promise<T> =>
      effect.pipe(
        Effect.tapCauseLogPretty,
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.provide(Layer.mergeAll(Observability, Logging)),
        Effect.scoped,
        Effect.runPromise,
      )
  }
}

const StorageCacheSchema = Schema.parseJson(
  Schema.Struct({
    storeId: Schema.String,

    // TODO
    currentHead: Schema.optional(EventSequenceNumber.GlobalEventSequenceNumber),
  }),
)
