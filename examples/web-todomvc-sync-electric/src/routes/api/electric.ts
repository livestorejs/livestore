import { Schema } from '@livestore/livestore'
import { ApiSchema, makeElectricUrl } from '@livestore/sync-electric'
import { createServerFileRoute } from '@tanstack/react-start/server'

import { makeDb } from '@/server/db.ts'

// You can change this to your own ElectricSQL endpoint
const electricHost = 'http://localhost:30000'

export const ServerRoute = createServerFileRoute('/api/electric').methods({
  // Client pulls from the server to get the latest mutation events
  GET: async ({ request }) => {
    const searchParams = new URL(request.url).searchParams
    const { url, storeId, needsInit, payload } = makeElectricUrl({
      electricHost,
      searchParams,
      // You can also provide a sourceId and sourceSecret for Electric Cloud
      // sourceId: 'your-source-id',
      // sourceSecret: 'your-source-secret',
      apiSecret: 'change-me-electric-secret',
    })

    if ((payload as any)?.authToken !== 'insecure-token-change-me') {
      return new Response(JSON.stringify({ error: 'Invalid auth token' }), { status: 401 })
    }

    // Here we initialize the database if it doesn't exist yet. You might not need this if you
    // already have the necessary tables created in the database.
    if (needsInit) {
      const db = makeDb(storeId)
      await db.migrate()
      await db.disconnect()
    }

    // We are simply proxying the request to the Electric server but you could implement
    // any custom logic here, e.g. auth, rate limiting, etc.
    return fetch(url)
  },
  // Client pushes new mutation events to the server
  POST: async ({ request }) => {
    const payload = await request.json()
    const parsedPayload = Schema.decodeUnknownSync(ApiSchema.PushPayload)(payload)

    const db = makeDb(parsedPayload.storeId)

    await db.createEvents(parsedPayload.batch)

    await db.disconnect()

    return new Response(JSON.stringify({ success: true }))
  },
})
