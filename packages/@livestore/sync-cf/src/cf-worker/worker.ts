import { UnexpectedError } from '@livestore/common'
import type { Schema } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'
import type { CfTypes, SearchParams } from '../common/mod.ts'
import type { CfDeclare } from './mod.ts'
import { DEFAULT_SYNC_DURABLE_OBJECT_NAME, type Env, getSyncRequestSearchParams } from './shared.ts'

// NOTE We need to redeclare runtime types here to avoid type conflicts with the lib.dom Response type.
declare class Response extends CfDeclare.Response {}

export namespace HelperTypes {
  type AnyDON = CfTypes.DurableObjectNamespace<undefined>

  type DOKeys<T> = {
    [K in keyof T]-?: T[K] extends AnyDON ? K : never
  }[keyof T]

  type NonBuiltins<T> = Omit<T, keyof Env>

  /**
   * Helper type to extract DurableObject keys from Env to give consumer type safety.
   *
   * @example
   * ```ts
   *  type PlatformEnv = {
   *    DB: D1Database
   *    ADMIN_TOKEN: string
   *    SYNC_BACKEND_DO: DurableObjectNamespace<SyncBackendDO>
   * }
   *  export default makeWorker<PlatformEnv>({
   *    durableObject: { name: "SYNC_BACKEND_DO" },
   *    // ^ (property) name?: "SYNC_BACKEND_DO" | undefined
   *  });
   */
  export type ExtractDurableObjectKeys<TEnv = Env> = DOKeys<NonBuiltins<TEnv>> extends never
    ? string
    : DOKeys<NonBuiltins<TEnv>>
}

// HINT: If we ever extend user's custom worker RPC, type T can help here with expected return type safety. Currently unused.
export type CFWorker<TEnv extends Env = Env, _T extends CfTypes.Rpc.DurableObjectBranded | undefined = undefined> = {
  fetch: <CFHostMetada = unknown>(
    request: CfTypes.Request<CFHostMetada>,
    env: TEnv,
    ctx: CfTypes.ExecutionContext,
  ) => Promise<CfTypes.Response>
}

export type MakeWorkerOptions<TEnv extends Env = Env> = {
  /**
   * Validates the payload during WebSocket connection establishment.
   * Note: This runs only at connection time, not for individual push events.
   * For push event validation, use the `onPush` callback in the durable object.
   */
  validatePayload?: (payload: Schema.JsonValue | undefined, context: { storeId: string }) => void | Promise<void>
  /** @default false */
  enableCORS?: boolean
  durableObject?: {
    /**
     * Needs to match the binding name from the wrangler config
     *
     * @default 'SYNC_BACKEND_DO'
     */
    name?: HelperTypes.ExtractDurableObjectKeys<TEnv>
  }
}

export const makeWorker = <
  TEnv extends Env = Env,
  TDurableObjectRpc extends CfTypes.Rpc.DurableObjectBranded | undefined = undefined,
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

      const requestParamsResult = getSyncRequestSearchParams(request)
      if (requestParamsResult._tag === 'Some') {
        return handleSyncRequest<TEnv, TDurableObjectRpc>({
          request,
          searchParams: requestParamsResult.value,
          env,
          ctx: _ctx,
          options: {
            headers: corsHeaders,
            validatePayload: options.validatePayload,
            durableObject: options.durableObject,
          },
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
 * Handles `/sync` endpoint.
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
 *     const requestParamsResult = getSyncRequestSearchParams(request)
 *
 *     // Is LiveStore sync request
 *     if (requestParamsResult._tag === 'Some') {
 *       return handleSyncRequest({
 *         request,
 *         searchParams: requestParamsResult.value,
 *         env,
 *         ctx,
 *         options: { headers: {}, validatePayload }
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
>({
  request,
  searchParams,
  env,
  options = {},
}: {
  request: CfTypes.Request<CFHostMetada>
  searchParams: SearchParams
  env: TEnv
  /** Only there for type-level reasons */
  ctx: CfTypes.ExecutionContext
  options?: {
    headers?: CfTypes.HeadersInit
    durableObject?: MakeWorkerOptions<TEnv>['durableObject']
    validatePayload?: (payload: Schema.JsonValue | undefined, context: { storeId: string }) => void | Promise<void>
  }
}): Promise<CfTypes.Response> =>
  Effect.gen(function* () {
    const { storeId, payload, transport } = searchParams

    if (options.validatePayload !== undefined) {
      const result = yield* Effect.promise(async () => options.validatePayload!(payload, { storeId })).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.either,
      )

      if (result._tag === 'Left') {
        console.error('Invalid payload', result.left)
        return new Response(result.left.toString(), { status: 400, headers: options.headers })
      }
    }

    const durableObjectName = options.durableObject?.name ?? DEFAULT_SYNC_DURABLE_OBJECT_NAME
    if (!(durableObjectName in env)) {
      return new Response(
        `Failed dependency: Required Durable Object binding '${durableObjectName as string}' not available`,
        {
          status: 424,
          headers: options.headers,
        },
      )
    }

    const durableObjectNamespace = env[
      durableObjectName as keyof TEnv
    ] as CfTypes.DurableObjectNamespace<TDurableObjectRpc>

    const id = durableObjectNamespace.idFromName(storeId)
    const durableObject = durableObjectNamespace.get(id)

    // Handle WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade')
    if (transport === 'ws' && (upgradeHeader === null || upgradeHeader !== 'websocket')) {
      return new Response('Durable Object expected Upgrade: websocket', {
        status: 426,
        headers: options?.headers,
      })
    }

    return yield* Effect.promise(() => durableObject.fetch(request))
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)
