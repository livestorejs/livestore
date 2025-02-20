import { ApiSchema, makeElectricUrl } from '@livestore/sync-electric'
import { createAPIFileRoute } from '@tanstack/start/api'
import { Schema } from 'effect'

import { makeDb } from '@/server/db.js'

const electricHost = 'http://localhost:30000'

export const APIRoute = createAPIFileRoute('/api/electric')({
  GET: async ({ request }) => {
    const { url, storeId, needsInit } = makeElectricUrl(electricHost, new URL(request.url).searchParams)

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
  POST: async ({ request }) => {
    const payload = await request.json()
    const parsedPayload = Schema.decodeUnknownSync(ApiSchema.PushPayload)(payload)

    const db = makeDb(parsedPayload.storeId)

    await db.createEvents(parsedPayload.batch)

    await db.disconnect()

    return new Response(JSON.stringify({ success: true }))
  },
})
