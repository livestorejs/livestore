import { makeWsSync } from '@livestore/sync-cf/client'

export { schema } from './src/lib/livestore/schema/index.ts'

/**
 * MCP entrypoint for the web-linearlite example.
 */
export const syncBackend = makeWsSync({ url: process.env.LIVESTORE_SYNC_URL ?? 'ws://localhost:8787' })
export const syncPayload = { authToken: process.env.LIVESTORE_SYNC_AUTH_TOKEN ?? 'insecure-token-change-me' }
