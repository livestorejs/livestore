import { makeWsSync } from '@livestore/sync-cf/client'

// Re-export your app's schema (adjust path to your project)
export { schema } from './schema.ts'

// Provide a sync backend constructor
export const syncBackend = makeWsSync({
  url: process.env.LIVESTORE_SYNC_URL ?? 'ws://localhost:8787',
})

// Optionally, pass an auth payload (must be JSON-serializable)
export const syncPayload = {
  authToken: process.env.LIVESTORE_SYNC_AUTH_TOKEN,
}
