import { Schema } from '@livestore/livestore'
import { ApiSchema, makeElectricUrl } from '@livestore/sync-electric'

const electricHost = 'http://localhost:30000' // Your Electric server

/** Placeholder for your database factory function */
declare const makeDb: (storeId: string) => {
  migrate: () => Promise<void>
  disconnect: () => Promise<void>
  createEvents: (batch: (typeof ApiSchema.PushPayload.Type)['batch']) => Promise<void>
}

// ---cut---

// GET /api/electric - Pull events (proxied through Electric)
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const { url, storeId, needsInit } = makeElectricUrl({
    electricHost,
    searchParams,
    apiSecret: 'your-electric-secret',
  })

  // Add your authentication logic here
  // if (!isAuthenticated(request)) {
  //   return new Response('Unauthorized', { status: 401 })
  // }

  // Initialize database tables if needed
  if (needsInit) {
    const db = makeDb(storeId)
    await db.migrate()
    await db.disconnect()
  }

  // Proxy pull request to Electric server for reading
  return fetch(url)
}

// POST /api/electric - Push events (direct database write)
export async function POST(request: Request) {
  const payload = await request.json()
  const parsed = Schema.decodeUnknownSync(ApiSchema.PushPayload)(payload)

  // Write events directly to Postgres table (bypasses Electric)
  const db = makeDb(parsed.storeId)
  await db.createEvents(parsed.batch)
  await db.disconnect()

  return Response.json({ success: true })
}
