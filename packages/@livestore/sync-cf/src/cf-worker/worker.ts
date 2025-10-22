import { env as importedEnv } from 'cloudflare:workers'
import { UnexpectedError } from '@livestore/common'
import type { HelperTypes } from '@livestore/common-cf'
import { Effect, Schema } from '@livestore/utils/effect'
import type { CfTypes, SearchParams } from '../common/mod.ts'
import type { CfDeclare } from './mod.ts'
import { type Env, matchSyncRequest } from './shared.ts'

// NOTE We need to redeclare runtime types here to avoid type conflicts with the lib.dom Response type.
declare class Response extends CfDeclare.Response {}

// HINT: If we ever extend user's custom worker RPC, type T can help here with expected return type safety. Currently unused.
export type CFWorker<TEnv extends Env = Env, _T extends CfTypes.Rpc.DurableObjectBranded | undefined = undefined> = {
  fetch: <CFHostMetada = unknown>(
    request: CfTypes.Request<CFHostMetada>,
    env: TEnv,
    ctx: CfTypes.ExecutionContext,
  ) => Promise<CfTypes.Response>
}

/**
 * Options accepted by {@link makeWorker}. The Durable Object binding has to be
 * supplied explicitly so we never fall back to deprecated defaults when Cloudflare config changes.
 */
export type MakeWorkerOptions<TEnv extends Env = Env, TSyncPayload = Schema.JsonValue> = {
  /**
   * Binding name of the sync Durable Object declared in wrangler config.
   */
  syncBackendBinding: HelperTypes.ExtractDurableObjectKeys<TEnv>
  /**
   * Validates the payload during WebSocket connection establishment.
   * Note: This runs only at connection time, not for individual push events.
   * For push event validation, use the `onPush` callback in the durable object.
   */
  /**
   * Optionally pass a schema to decode the client-provided payload into a typed object
   * before calling {@link validatePayload}. If omitted, the raw JSON value is forwarded.
   */
  syncPayloadSchema?: Schema.Schema<TSyncPayload>
  /**
   * Validates the (optionally decoded) payload during WebSocket connection establishment.
   * If {@link syncPayloadSchema} is provided, `payload` will be of the schema’s inferred type.
   */
  validatePayload?: (payload: TSyncPayload, context: { storeId: string }) => void | Promise<void>
  /** @default false */
  enableCORS?: boolean
}

/**
 * Produces a Cloudflare Worker `fetch` handler that delegates sync traffic to the
 * Durable Object identified by `syncBackendBinding`.
 *
 * For more complex setups prefer implementing a custom `fetch` and call {@link handleSyncRequest}
 * from the branch that handles LiveStore sync requests.
 */
export const makeWorker = <
  TEnv extends Env = Env,
  TDurableObjectRpc extends CfTypes.Rpc.DurableObjectBranded | undefined = undefined,
  TSyncPayload = Schema.JsonValue,
>(
  options: MakeWorkerOptions<TEnv, TSyncPayload>,
): CFWorker<TEnv, TDurableObjectRpc> => {
  return {
    fetch: async (request, env, _ctx) => {
      const url = new URL(request.url)

      const corsHeaders: CfTypes.HeadersInit = options.enableCORS
        ? {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? '*',
          }
        : {}

      if (request.method === 'OPTIONS' && options.enableCORS) {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        })
      }

      const searchParams = matchSyncRequest(request)

      // Check if this is a sync request first, before showing info message
      if (searchParams !== undefined) {
        return handleSyncRequest<TEnv, TDurableObjectRpc, unknown, TSyncPayload>({
          request,
          searchParams,
          env,
          ctx: _ctx,
          syncBackendBinding: options.syncBackendBinding,
          headers: corsHeaders,
          validatePayload: options.validatePayload,
          syncPayloadSchema: options.syncPayloadSchema,
        })
      }

      // Only show info message for GET requests to / without sync parameters
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response('Info: Sync backend endpoint for @livestore/sync-cf.', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }

      console.error('Invalid path', url.pathname)

      return new Response('Invalid path', {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
        },
      })
    },
  }
}

/**
 * Handles LiveStore sync requests (e.g. with search params `?storeId=...&transport=...`).
 *
 * @example
 * ```ts
 * const validatePayload = (payload: Schema.JsonValue | undefined, context: { storeId: string }) => {
 *   console.log(`Validating connection for store: ${context.storeId}`)
 *   if (payload?.authToken !== 'insecure-token-change-me') {
 *     throw new Error('Invalid auth token')
 *   }
 * }
 *
 * export default {
 *   fetch: async (request, env, ctx) => {
 *     const searchParams = matchSyncRequest(request)
 *
 *     // Is LiveStore sync request
 *     if (searchParams !== undefined) {
 *       return handleSyncRequest({
 *         request,
 *         searchParams,
 *         env,
 *         ctx,
 *         syncBackendBinding: 'SYNC_BACKEND_DO',
 *         headers: {},
 *         validatePayload,
 *       })
 *     }
 *
 *     return new Response('Invalid path', { status: 400 })
 *   }
 * }
 * ```
 *
 * @throws {UnexpectedError} If the payload is invalid
 */
export const handleSyncRequest = <
  TEnv extends Env = Env,
  TDurableObjectRpc extends CfTypes.Rpc.DurableObjectBranded | undefined = undefined,
  CFHostMetada = unknown,
  TSyncPayload = Schema.JsonValue,
>({
  request,
  searchParams: { storeId, payload, transport },
  env: explicitlyProvidedEnv,
  syncBackendBinding,
  headers,
  validatePayload,
  syncPayloadSchema,
}: {
  request: CfTypes.Request<CFHostMetada>
  searchParams: SearchParams
  env?: TEnv | undefined
  /** Only there for type-level reasons */
  ctx: CfTypes.ExecutionContext
  /** Binding name of the sync backend Durable Object */
  syncBackendBinding: MakeWorkerOptions<TEnv, TSyncPayload>['syncBackendBinding']
  headers?: CfTypes.HeadersInit | undefined
  validatePayload?: MakeWorkerOptions<TEnv, TSyncPayload>['validatePayload']
  syncPayloadSchema?: MakeWorkerOptions<TEnv, TSyncPayload>['syncPayloadSchema']
}): Promise<CfTypes.Response> =>
  Effect.gen(function* () {
    if (validatePayload !== undefined) {
      // Always decode with the supplied schema when present, even if payload is undefined.
      // This ensures required payloads are enforced by the schema.
      if (syncPayloadSchema !== undefined) {
        const decodedEither = Schema.decodeUnknownEither(syncPayloadSchema)(payload)
        if (decodedEither._tag === 'Left') {
          const message = decodedEither.left.toString()
          console.error('Invalid payload (decode failed)', message)
          return new Response(message, { status: 400, headers })
        }

        const result = yield* Effect.promise(async () => validatePayload(decodedEither.right as TSyncPayload, { storeId })).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.either,
        )

        if (result._tag === 'Left') {
          console.error('Invalid payload (validation failed)', result.left)
          return new Response(result.left.toString(), { status: 400, headers })
        }
      } else {
        const result = yield* Effect.promise(async () => validatePayload(payload as TSyncPayload, { storeId })).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.either,
        )

        if (result._tag === 'Left') {
          console.error('Invalid payload (validation failed)', result.left)
          return new Response(result.left.toString(), { status: 400, headers })
        }
      }
    }

    const env = explicitlyProvidedEnv ?? (importedEnv as TEnv)

    if (!(syncBackendBinding in env)) {
      return new Response(
        `Failed dependency: Required Durable Object binding '${syncBackendBinding as string}' not available`,
        {
          status: 424,
          headers,
        },
      )
    }

    const durableObjectNamespace = env[
      syncBackendBinding as keyof TEnv
    ] as CfTypes.DurableObjectNamespace<TDurableObjectRpc>

    const id = durableObjectNamespace.idFromName(storeId)
    const durableObject = durableObjectNamespace.get(id)

    // Handle WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade')
    if (transport === 'ws' && (upgradeHeader === null || upgradeHeader !== 'websocket')) {
      return new Response('Durable Object expected Upgrade: websocket', {
        status: 426,
        headers,
      })
    }

    return yield* Effect.promise(() => durableObject.fetch(request))
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)
