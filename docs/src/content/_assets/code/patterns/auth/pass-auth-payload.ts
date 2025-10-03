import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'
import * as jose from 'jose'

const JWT_SECRET = 'a-string-secret-at-least-256-bits-long'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message) => {
    console.log('onPush', message.batch)
  },
  onPull: async (message) => {
    console.log('onPull', message)
  },
}) {}

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: async (payload: any, context) => {
    const { storeId } = context
    const { authToken } = payload

    if (!authToken) {
      throw new Error('No auth token provided')
    }

    const user = await getUserFromToken(authToken)

    if (!user) {
      throw new Error('Invalid auth token')
    } else {
      // User is authenticated!
      console.log('Sync backend payload', JSON.stringify(user, null, 2))
    }

    // Check if token is expired
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired')
    }

    await checkUserAccess(user, storeId)
  },
  enableCORS: true,
})

async function getUserFromToken(token: string): Promise<jose.JWTPayload | undefined> {
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
    return payload
  } catch (error) {
    console.log('⚠️ Error verifying token', error)
  }
}

async function checkUserAccess(payload: jose.JWTPayload, storeId: string): Promise<void> {
  // Check if user is authorized to access the store
  console.log('Checking access for store', storeId, 'with payload', payload)
}
