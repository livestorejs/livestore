import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

import { presenceSchemas } from './schemas.ts'

type SyncPayload = { authToken?: string }

const ensureAuthorized = (payload: unknown): { userId: string } => {
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    throw new Error('Missing auth payload')
  }
  const { authToken } = payload as SyncPayload
  if (authToken == null) {
    throw new Error('Missing auth token')
  }
  return { userId: authToken }
}

const canAccessRoom = (_userId: string, roomId: string): boolean => roomId.startsWith('chat:')

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload) => {
    ensureAuthorized(payload)
  },
})

export class SyncBackendDO extends makeDurableObject({
  presence: {
    schemas: presenceSchemas,
    onJoin: (event, context) => {
      const { userId } = ensureAuthorized(context.payload)
      if (canAccessRoom(userId, event.roomId) === false) {
        throw new Error('Not a member of this room')
      }
    },
  },
}) {}
