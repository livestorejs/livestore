/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { DomainEvent } from './shared.ts'
import { type Env, storeIdFromRequest } from './shared.ts'

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

  // Queue consumer handler for domain events
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[QueueConsumer] Processing ${batch.messages.length} domain events`)

    // Aggregate delta updates by labelId
    const labelDeltas = new Map<string, number>()
    const threadsToAdd: Array<{ id: string; subject: string; participants: string[]; createdAt: Date }> = []

    for (const message of batch.messages) {
      try {
        const { name, data } = message.body as DomainEvent

        if (name === 'v1.ThreadLabelApplied') {
          const delta = +1
          labelDeltas.set(data.labelId, (labelDeltas.get(data.labelId) || 0) + delta)
          console.log(`[QueueConsumer] v1.ThreadLabelApplied: thread=${data.threadId}, label=${data.labelId}`)
        } else if (name === 'v1.ThreadLabelRemoved') {
          const delta = -1
          labelDeltas.set(data.labelId, (labelDeltas.get(data.labelId) || 0) + delta)
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

    // Update InboxClientDO with aggregated deltas
    const inboxStub = env.INBOX_CLIENT_DO.getByName('inbox-root')

    // Update label counts
    for (const [labelId, delta] of labelDeltas.entries()) {
      if (delta !== 0) {
        ctx.waitUntil(
          inboxStub
            .updateLabelCount({ labelId, delta })
            .then(() => {
              console.log(`[QueueConsumer] Updated label ${labelId} with delta ${delta}`)
            })
            .catch((error) => {
              console.error(`[QueueConsumer] Failed to update InboxClientDO for label ${labelId}:`, error)
              // Log and continue (per user preference)
            }),
        )
      }
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
            console.error(`[QueueConsumer] Failed to add thread ${thread.id} to Inbox:`, error)
          }),
      )
    }
  },
} satisfies SyncBackend.CfTypes.ExportedHandler<Env>
