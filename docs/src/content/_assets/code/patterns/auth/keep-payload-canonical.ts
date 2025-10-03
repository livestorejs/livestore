import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'
import type { SyncMessage } from '@livestore/sync-cf/common'

import { verifyJwt } from './verify-jwt.ts'

// ---cut---
type SyncPayload = { authToken?: string; userId?: string }

type AuthorizedSession = {
  authToken: string
  userId: string
}

const ensureAuthorized = (payload: unknown): AuthorizedSession => {
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    throw new Error('Missing auth payload')
  }

  const { authToken, userId } = payload as SyncPayload
  if (!authToken) {
    throw new Error('Missing auth token')
  }

  const claims = verifyJwt(authToken)
  if (!claims.sub) {
    throw new Error('Token missing subject claim')
  }

  if (userId !== undefined && userId !== claims.sub) {
    throw new Error('Payload userId mismatch')
  }

  return { authToken, userId: claims.sub }
}

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload) => {
    ensureAuthorized(payload)
  },
})

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message: SyncMessage.PushRequest, { payload }) => {
    const { userId } = ensureAuthorized(payload)
    await ensureTenantAccess(userId, message.batch)
  },
}) {}

const ensureTenantAccess = async (_userId: string, _batch: SyncMessage.PushRequest['batch']) => {
  // Replace with your application-specific access checks.
}
