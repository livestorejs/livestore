/// <reference path="./types.d.ts" />

import type { DurableObjectState } from 'cloudflare:workers'
import { createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import type { Env } from './env.ts'
import { schema } from './schema.ts'

export const maybeResetStore = async ({
  request,
  env,
  ctx,
}: {
  request: Request
  env: Env
  ctx: DurableObjectState
}) => {
  const url = new URL(request.url)
  const shouldReset =
    env.ADMIN_SECRET === url.searchParams.get('token') && url.pathname === '/internal/livestore-dev-reset'

  const storeId = url.searchParams.get('storeId') ?? nanoid()

  const store = await createStoreDoPromise({
    schema,
    storeId,
    clientId: 'client-do',
    sessionId: nanoid(),
    durableObject: {
      ctx: ctx as CfTypes.DurableObjectState,
      env,
      bindingName: 'CLIENT_DO',
    },
    syncBackendStub: env.SYNC_BACKEND_DO.get(env.SYNC_BACKEND_DO.idFromName(storeId)),
    livePull: true,
    resetPersistence: shouldReset,
  })

  return store
}
