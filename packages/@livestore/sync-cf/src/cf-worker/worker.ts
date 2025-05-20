import { UnexpectedError } from '@livestore/common'
import type { Schema } from '@livestore/utils/effect'
import { Effect, UrlParams } from '@livestore/utils/effect'

import { SearchParamsSchema } from '../common/mod.js'
import type { Env } from './durable-object.js'

export type CFWorker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
}

export type MakeWorkerOptions = {
  validatePayload?: (payload: Schema.JsonValue | undefined) => void | Promise<void>
  /** @default false */
  enableCORS?: boolean
  durableObject?: {
    /**
     * Needs to match the binding name from the wrangler config
     *
     * @default 'WEBSOCKET_SERVER'
     */
    name?: string
  }
}

export const makeWorker = (options: MakeWorkerOptions = {}): CFWorker => {
  return {
    fetch: async (request, env, _ctx) => {
      const url = new URL(request.url)

      if (request.method === 'GET' && url.pathname === '/') {
        return new Response('Info: WebSocket sync backend endpoint for @livestore/sync-cf.', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
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
        })
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
export const handleWebSocket = (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  options: {
    headers?: HeadersInit
    durableObject?: MakeWorkerOptions['durableObject']
    validatePayload?: (payload: Schema.JsonValue | undefined) => void | Promise<void>
  },
): Promise<Response> =>
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
    const durableObjectNamespace = (env as any)[durableObjectName] as DurableObjectNamespace

    const id = durableObjectNamespace.idFromName(storeId)
    const durableObject = durableObjectNamespace.get(id)

    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', { status: 426, headers: options?.headers })
    }

    return yield* Effect.promise(() => durableObject.fetch(request))
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)
