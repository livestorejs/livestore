import { makeWsSync } from '@livestore/sync-cf/client'
import { SyncPayload } from './src/livestore/schema.ts'

export { schema } from './src/livestore/schema.ts'

/**
 * MCP entrypoint for the cf-chat example.
 */
export const syncBackend = makeWsSync({ url: process.env.LIVESTORE_SYNC_URL ?? 'ws://localhost:8787' })
export const syncPayload = { authToken: process.env.LIVESTORE_SYNC_AUTH_TOKEN ?? 'insecure-token-change-me' }
export const syncPayloadSchema = SyncPayload
