/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { CrossStoreEvent, Env } from './shared.ts'

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

    if (url.pathname.includes('/inbox-client-do')) {
      const storeId = storeIdFromRequest(request)
      await env.INBOX_CLIENT_DO.getByName(storeId).initialize({ storeId })
      // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
      return new Response('Inbox Client DO initialized', { status: 200 }) as SyncBackend.CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    return new Response('Not found', { status: 404 }) as SyncBackend.CfTypes.Response
  },

  // Queue consumer handler for cross-store events
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[QueueConsumer] Processing ${batch.messages.length} cross-store events`)

    const threadsToAdd: Array<{ id: string; subject: string; participants: string[]; createdAt: Date }> = []
    const labelsToApply: Array<{ threadId: string; labelId: string; appliedAt: Date }> = []
    const labelsToRemove: Array<{ threadId: string; labelId: string; removedAt: Date }> = []

    for (const message of batch.messages) {
      try {
        const { name, data } = message.body as CrossStoreEvent

        if (name === 'v1.ThreadLabelApplied') {
          labelsToApply.push({
            threadId: data.threadId,
            labelId: data.labelId,
            appliedAt: new Date(data.appliedAt),
          })
          console.log(`[QueueConsumer] v1.ThreadLabelApplied: thread=${data.threadId}, label=${data.labelId}`)
        } else if (name === 'v1.ThreadLabelRemoved') {
          labelsToRemove.push({
            threadId: data.threadId,
            labelId: data.labelId,
            removedAt: new Date(data.removedAt),
          })
          console.log(`[QueueConsumer] v1.ThreadLabelRemoved: thread=${data.threadId}, label=${data.labelId}`)
        } else if (name === 'v1.ThreadCreated') {
          // Convert date string back to Date object (Cloudflare Queues serializes Dates to ISO strings)
          threadsToAdd.push({
            ...data,
            createdAt: new Date(data.createdAt),
          })
          console.log(`[QueueConsumer] v1.ThreadCreated: thread=${data.id}, subject="${data.subject}"`)
        }

        message.ack()
      } catch (error) {
        console.error('[QueueConsumer] Failed to process message:', error, message.body)
      }
    }

    const inboxStub = env.INBOX_CLIENT_DO.getByName('inbox-root')

    // Apply thread labels (materializer automatically updates count)
    for (const label of labelsToApply) {
      ctx.waitUntil(
        inboxStub
          .applyThreadLabel(label)
          .then(() => {
            console.log(`[QueueConsumer] Applied label ${label.labelId} to thread ${label.threadId}`)
          })
          .catch((error) => {
            console.error(`[QueueConsumer] Failed to apply label:`, error)
          }),
      )
    }

    // Remove thread labels (materializer automatically updates count)
    for (const label of labelsToRemove) {
      ctx.waitUntil(
        inboxStub
          .removeThreadLabel(label)
          .then(() => {
            console.log(`[QueueConsumer] Removed label ${label.labelId} from thread ${label.threadId}`)
          })
          .catch((error) => {
            console.error(`[QueueConsumer] Failed to remove label:`, error)
          }),
      )
    }

    // Add threads to Inbox
    for (const thread of threadsToAdd) {
      ctx.waitUntil(
        inboxStub
          .addThread(thread)
          .then(() => {
            console.log(`[QueueConsumer] Added thread ${thread.id} to Inbox`)
          })
          .catch((error) => {
            console.error(`[QueueConsumer] Failed to add thread:`, error)
          }),
      )
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
