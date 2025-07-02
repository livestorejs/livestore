import type * as CfWorker from '@cloudflare/workers-types'
import { UnexpectedError } from '@livestore/common'
import type { Schema } from '@livestore/utils/effect'
import { Effect, UrlParams } from '@livestore/utils/effect'

import { SearchParamsSchema } from '../common/mod.js'
import type { Env } from './durable-object.js'

// Redeclaring Response to Cloudflare Worker Response type to avoid lib.dom type clashing
declare const Response: typeof CfWorker.Response

/**
 * Helper type to extract DurableObject keys from Env to give consumer type safety.
 *
 * @example
 * ```ts
 *  type PlatformEnv = {
 *    DB: D1Database
 *    ADMIN_TOKEN: string
 *    WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>
 * }
 *  export default makeWorker<PlatformEnv>({
 *    durableObject: { name: "WEBSOCKET_SERVER" },
 *    // ^ (property) name?: "WEBSOCKET_SERVER" | undefined
 *  });
 */
type ExtractDurableObjectKeys<TEnv = Env> = TEnv extends Env
  ? [keyof TEnv] extends [keyof Env]
    ? string
    : keyof {
        [K in keyof TEnv as K extends keyof Env
          ? never
          : TEnv[K] extends CfWorker.DurableObjectNamespace<any>
            ? K
            : never]: TEnv[K]
      }
  : never

// HINT: If we ever extend user's custom worker RPC, type T can help here with expected return type safety. Currently unused.
export type CFWorker<TEnv extends Env = Env, T extends CfWorker.Rpc.DurableObjectBranded | undefined = undefined> = {
  fetch: <CFHostMetada = unknown>(
    request: CfWorker.Request<CFHostMetada>,
    env: TEnv,
    ctx: CfWorker.ExecutionContext,
  ) => Promise<CfWorker.Response>
}

export type MakeWorkerOptions<TEnv extends Env = Env> = {
  validatePayload?: (payload: Schema.JsonValue | undefined) => void | Promise<void>
  /** @default false */
  enableCORS?: boolean
  durableObject?: {
    /**
     * Needs to match the binding name from the wrangler config
     *
     * @default 'WEBSOCKET_SERVER'
     */
    name?: ExtractDurableObjectKeys<TEnv>
  }
}

export const makeWorker = <
  TEnv extends Env = Env,
  TDurableObjectRpc extends CfWorker.Rpc.DurableObjectBranded | undefined = undefined,
>(
  options: MakeWorkerOptions<TEnv> = {},
): CFWorker<TEnv, TDurableObjectRpc> => {
  return {
    fetch: async (request, env, _ctx) => {
      const url = new URL(request.url)

      await new Promise((resolve) => setTimeout(resolve, 500))

      if (request.method === 'GET' && url.pathname === '/') {
        return new Response('Info: WebSocket sync backend endpoint for @livestore/sync-cf.', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }

      const corsHeaders: CfWorker.HeadersInit = options.enableCORS
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

      if (url.pathname.endsWith('/websocket')) {
        return handleWebSocket<TEnv, TDurableObjectRpc>(request, env, _ctx, {
          headers: corsHeaders,
          validatePayload: options.validatePayload,
          durableObject: options.durableObject,
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
 * Handles `/websocket` endpoint.
 *
 * @example
 * ```ts
 * const validatePayload = (payload: Schema.JsonValue | undefined) => {
 *   if (payload?.authToken !== 'insecure-token-change-me') {
 *     throw new Error('Invalid auth token')
 *   }
 * }
 *
 * export default {
 *   fetch: async (request, env, ctx) => {
 *     if (request.url.endsWith('/websocket')) {
 *       return handleWebSocket(request, env, ctx, { headers: {}, validatePayload })
 *     }
 *
 *     return new Response('Invalid path', { status: 400, headers: corsHeaders })
 *   }
 * }
 * ```
 *
 * @throws {UnexpectedError} If the payload is invalid
 */
export const handleWebSocket = <
  TEnv extends Env = Env,
  TDurableObjectRpc extends CfWorker.Rpc.DurableObjectBranded | undefined = undefined,
  CFHostMetada = unknown,
>(
  request: CfWorker.Request<CFHostMetada>,
  env: TEnv,
  _ctx: CfWorker.ExecutionContext,
  options: {
    headers?: CfWorker.HeadersInit
    durableObject?: MakeWorkerOptions<TEnv>['durableObject']
    validatePayload?: (payload: Schema.JsonValue | undefined) => void | Promise<void>
  },
): Promise<CfWorker.Response> =>
  Effect.gen(function* () {
    const url = new URL(request.url)

    const urlParams = UrlParams.fromInput(url.searchParams)
    const paramsResult = yield* UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.either)

    if (paramsResult._tag === 'Left') {
      return new Response(`Invalid search params: ${paramsResult.left.toString()}`, {
        status: 500,
        headers: options?.headers,
      })
    }

    const { storeId, payload } = paramsResult.right

    if (options.validatePayload !== undefined) {
      const result = yield* Effect.promise(async () => options.validatePayload!(payload)).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.either,
      )

      if (result._tag === 'Left') {
        console.error('Invalid payload', result.left)
        return new Response(result.left.toString(), { status: 400, headers: options.headers })
      }
    }

    const durableObjectName = options.durableObject?.name ?? 'WEBSOCKET_SERVER'
    if (!(durableObjectName in env)) {
      return new Response(`Failed dependency: Required Durable Object binding '${durableObjectName}' not available`, {
        status: 424,
        headers: options.headers,
      })
    }

    const durableObjectNamespace = env[
      durableObjectName as keyof TEnv
    ] as CfWorker.DurableObjectNamespace<TDurableObjectRpc>

    const id = durableObjectNamespace.idFromName(storeId)
    const durableObject = durableObjectNamespace.get(id)

    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', {
        status: 426,
        headers: options?.headers,
      })
    }

    // Cloudflare Durable Object type clashing with lib.dom Response type, which is why we need the casts here.
    return yield* Effect.promise(() => durableObject.fetch(request as any) as unknown as Promise<CfWorker.Response>)
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)
