import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  // Forward Cookie and Authorization headers to onPush/onPull callbacks
  forwardHeaders: ['Cookie', 'Authorization'],

  onPush: async (message, context) => {
    const { storeId, headers } = context

    // Access forwarded headers in callbacks
    const cookie = headers?.get('cookie')
    const _authorization = headers?.get('authorization')

    if (cookie) {
      // Parse session from cookie (example with better-auth)
      const sessionToken = parseCookie(cookie, 'session_token')
      const session = await getSessionFromToken(sessionToken)

      if (!session) {
        throw new Error('Invalid session')
      }

      console.log('Push from user:', session.userId, 'store:', storeId)
    }

    console.log('onPush', message.batch)
  },

  onPull: async (message, context) => {
    const { storeId, headers } = context

    // Same header access in onPull
    const cookie = headers?.get('cookie')

    if (cookie) {
      const sessionToken = parseCookie(cookie, 'session_token')
      const session = await getSessionFromToken(sessionToken)

      if (!session) {
        throw new Error('Invalid session')
      }

      console.log('Pull from user:', session.userId, 'store:', storeId)
    }

    console.log('onPull', message)
  },
}) {}

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  // Optional: validate at worker level using headers
  validatePayload: async (_payload, context) => {
    const { headers } = context
    const cookie = headers.get('cookie')

    if (cookie) {
      const sessionToken = parseCookie(cookie, 'session_token')
      const session = await getSessionFromToken(sessionToken)

      if (!session) {
        throw new Error('Unauthorized: Invalid session')
      }
    }
  },
  enableCORS: true,
})

// --- Helper functions (implement based on your auth library) ---

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    const [key, value] = cookie.split('=')
    if (key === name) return value
  }
  return undefined
}

interface Session {
  userId: string
  email: string
}

async function getSessionFromToken(_token: string | undefined): Promise<Session | null> {
  // Implement session lookup using your auth library
  // Example with better-auth:
  // return await auth.api.getSession({ headers: { cookie: `session_token=${token}` } })
  return { userId: 'user-123', email: 'user@example.com' }
}
