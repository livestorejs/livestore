/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

import type { CrossStoreEventEncoded, Env } from './shared.ts'

export default {
  fetch: async (request, env, ctx) => {
    console.log(`[Fetch] ${request.method} ${request.url}`)
    // Handle LiveStore sync requests
    const searchParams = SyncBackend.matchSyncRequest(request)
    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        validatePayload: () => {
          // Custom validation logic...
        },
      })
    }

    const url = new URL(request.url)

    if (url.pathname.includes('/mailbox-client-do')) {
      const storeId = storeIdFromRequest(request)
      await env.MAILBOX_CLIENT_DO.getByName(storeId).initialize({ storeId })
      // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
      return new Response('Mailbox Client DO initialized', { status: 200 }) as SyncBackend.CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    return new Response('Not found', { status: 404 }) as SyncBackend.CfTypes.Response
  },

  // Queue consumer handler for cross-store events
  async queue(batch, env: Env, ctx) {
    console.log(`[QueueConsumer] Processing ${batch.messages.length} cross-store events`)

    const mailboxStub = env.MAILBOX_CLIENT_DO.getByName('mailbox-root')

    for (const message of batch.messages) {
      const event = message.body as CrossStoreEventEncoded
      console.log(`[QueueConsumer] ${event.name}`)

      ctx.waitUntil(
        mailboxStub.handleCrossStoreEvent(event).catch((error) => {
          console.error(`[QueueConsumer] Failed to handle ${event.name}:`, error)
        }),
      )

      message.ack()
    }
  },
} satisfies SyncBackend.CfTypes.ExportedHandler<Env>

const storeIdFromRequest = (request: SyncBackend.CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
