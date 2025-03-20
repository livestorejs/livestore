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
}

export const makeWorker = (options: MakeWorkerOptions = {}): CFWorker => {
  return {
    fetch: async (request, env, _ctx) =>
      Effect.gen(function* () {
        const url = new URL(request.url)
        const urlParams = UrlParams.fromInput(url.searchParams)
        const paramsResult = yield* UrlParams.schemaStruct(SearchParamsSchema)(urlParams).pipe(Effect.either)

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

        if (paramsResult._tag === 'Left') {
          return new Response(`Invalid search params: ${paramsResult.left.toString()}`, {
            status: 500,
            headers: corsHeaders,
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
            return new Response(result.left.toString(), { status: 400, headers: corsHeaders })
          }
        }

        const id = env.WEBSOCKET_SERVER.idFromName(storeId)
        const durableObject = env.WEBSOCKET_SERVER.get(id)

        if (url.pathname.endsWith('/websocket')) {
          const upgradeHeader = request.headers.get('Upgrade')
          if (!upgradeHeader || upgradeHeader !== 'websocket') {
            return new Response('Durable Object expected Upgrade: websocket', { status: 426, headers: corsHeaders })
          }

          return durableObject.fetch(request)
        }

        console.error('Invalid path', url.pathname)
        return new Response(null, {
          status: 400,
          statusText: 'Bad Request',
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/plain',
          },
        })
      }).pipe(Effect.tapCauseLogPretty, Effect.runPromise),
  }
}
