import { UnexpectedError } from '@livestore/common'
import type { Schema } from '@livestore/utils/effect'
import { Effect, UrlParams } from '@livestore/utils/effect'

import { SearchParamsSchema } from '../common/mod.js'
import type { Env } from './durable-object.js'
import type {
  ExecutionContext,
  Request,
  Rpc,
  DurableObjectNamespace,
  HeadersInit,
  Response as CFResponse,
} from '@cloudflare/workers-types'

type ExtractDurableObjectKeys<TEnv = Env> = TEnv extends Env
  ? [keyof TEnv] extends [keyof Env]
    ? string
    : keyof {
        [K in keyof TEnv as K extends keyof Env
          ? never
          : TEnv[K] extends DurableObjectNamespace<any>
            ? K
            : never]: TEnv[K]
      }
  : never

export type CFWorker<TEnv extends Env = Env, T extends Rpc.DurableObjectBranded | undefined = undefined> = {
  fetch: <CFHostMetada = unknown>(
    request: Request<CFHostMetada>,
    env: TEnv,
    ctx: ExecutionContext,
  ) => Promise<CFResponse>
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
  TDurableObjectRpc extends Rpc.DurableObjectBranded | undefined = undefined,
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
        }) as unknown as CFResponse
      }

      const corsHeaders: HeadersInit = options.enableCORS
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
        }) as unknown as CFResponse
      }

      if (url.pathname.endsWith('/websocket')) {
        return handleWebSocket(request, env, _ctx, {
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
      }) as unknown as CFResponse
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
  TDurableObjectRpc extends Rpc.DurableObjectBranded | undefined = undefined,
  CFHostMetada = unknown,
>(
  request: Request<CFHostMetada>,
  env: TEnv,
  _ctx: ExecutionContext,
  options: {
    headers?: HeadersInit
    durableObject?: MakeWorkerOptions<TEnv>['durableObject']
    validatePayload?: (payload: Schema.JsonValue | undefined) => void | Promise<void>
  },
): Promise<CFResponse> =>
  Effect.gen(function* () {
    const url = new URL(request.url)

    const urlParams = UrlParams.fromInput(url.searchParams)
    const paramsResult = yield* UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.either)

    if (paramsResult._tag === 'Left') {
      return new Response(`Invalid search params: ${paramsResult.left.toString()}`, {
        status: 500,
        headers: options?.headers as any,
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
        return new Response(result.left.toString(), { status: 400, headers: options.headers as any })
      }
    }

    const durableObjectName = options.durableObject?.name ?? 'WEBSOCKET_SERVER'
    if (!(durableObjectName in env)) {
      return new Response(`Failed dependency: Required Durable Object binding '${durableObjectName}' not available`, {
        status: 424,
        headers: options.headers as any,
      })
    }

    const durableObjectNamespace = env[durableObjectName as keyof TEnv] as DurableObjectNamespace<TDurableObjectRpc>

    const id = durableObjectNamespace.idFromName(storeId)
    const durableObject = durableObjectNamespace.get(id)

    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', {
        status: 426,
        headers: options?.headers as any,
      })
    }

    return yield* Effect.promise(() => durableObject.fetch(request as any))
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise) as unknown as Promise<CFResponse>
