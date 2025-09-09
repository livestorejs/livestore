/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import { DurableObject } from 'cloudflare:workers'
import type { AlarmInvocationInfo } from '@cloudflare/workers-types'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { events, schema, tables } from '../livestore/schema.ts'
import { seedEmailClientData } from '../livestore/seed.ts'

type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  SYNC_BACKEND_URL: string
  DB: D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, { storeId }) => {
    console.log(
      `📤 Email sync push for store (${storeId}) - ${message.batch.length} events:`,
      message.batch.map((e) => e.name).join(', '),
    )
  },
}) {}

// Scoped by storeId
export class LiveStoreClientDO extends DurableObject implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'livestore-client-do' as never
  private storeId: string | undefined
  private cachedStore: Store<typeof schema> | undefined
  private storeSubscription: Unsubscribe | undefined

  constructor(
    readonly state: DurableObjectState,
    readonly env: Env,
  ) {
    super(state, env)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      this.storeId = storeIdFromRequest(request)

      const store = await this.getStore()

      // Kick off cross-aggregate event subscriptions for email functionality
      await this.subscribeToStore()

      // Query email-specific data instead of chat data
      const threads = store.query(tables.threads)
      const messages = store.query(tables.messages)
      const labels = store.query(tables.labels)
      const threadLabels = store.query(tables.threadLabels)
      const syncState = await store._dev.syncStates()

      const url = new URL(request.url)
      if (url.pathname.endsWith('/db')) {
        const snapshot = store.sqliteDbWrapper.export()
        return new Response(snapshot, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="db-${this.storeId}.db"`,
          },
        })
      }

      return new Response(JSON.stringify({ threads, messages, labels, threadLabels, syncState }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    } catch (error) {
      console.error('Error in fetch', error)
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
    }
  }

  async getStore() {
    if (this.cachedStore !== undefined) {
      return this.cachedStore
    }

    const storeId = this.storeId!
    const store = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'client-do',
      sessionId: nanoid(),
      durableObjectId: this.state.id.toString(),
      bindingName: 'CLIENT_DO',
      storage: this.state.storage as any,
      syncBackendDurableObject: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      livePull: true,
    })

    this.cachedStore = store

    // Check if the store needs seeding (server-side seeding)
    await this.ensureStoreSeeded(store)

    return store
  }

  private async ensureStoreSeeded(store: Store<typeof schema>) {
    // Check if seeding has already been done by looking for system labels
    const existingLabelCount = store.query(tables.labels.count())

    if (existingLabelCount > 0) {
      console.log('📧 Email store already seeded with', existingLabelCount, 'labels')
      return
    }

    console.log('🌱 Seeding email client data server-side...')
    try {
      seedEmailClientData(store)

      // Wait for all commits to be processed by LiveStore
      // This ensures all events are available for sync to client
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Verify seeding completed by checking for expected data
      const labels = store.query(tables.labels.where({}))
      const threads = store.query(tables.threads.where({}))
      const messages = store.query(tables.messages.where({}))

      console.log(
        `✅ Server-side seeding verified: ${labels.length} labels, ${threads.length} threads, ${messages.length} messages`,
      )
    } catch (error) {
      console.error('❌ Server-side seeding failed:', error)
      throw error
    }
  }

  async subscribeToStore() {
    const store = await this.getStore()

    // Make sure to only subscribe once
    if (this.storeSubscription === undefined) {
      console.log(`📧 Setting up cross-aggregate event subscriptions for email client...`)

      // Subscribe to ThreadLabel events to implement cross-aggregate reactions
      // This demonstrates the core architecture requirement: when thread labels change,
      // the label message counts need to be updated automatically
      const threadLabelsQuery = tables.threadLabels.where({})
      const unsubscribe = store.subscribe(threadLabelsQuery, {
        onUpdate: (threadLabels) => {
          console.log(`🏷️ Thread labels updated, checking for cross-aggregate updates needed`)

          // Get current labels to identify system labels
          const labels = store.query(tables.labels.where({}))
          const systemLabels = labels.filter((l) => l.type === 'system')
          const systemLabelIds = new Set(systemLabels.map((l) => l.id))

          // BUSINESS RULE: Enforce "one system label per thread"
          const threadSystemLabels = new Map<string, string[]>()
          for (const threadLabel of threadLabels) {
            if (systemLabelIds.has(threadLabel.labelId)) {
              const existing = threadSystemLabels.get(threadLabel.threadId) || []
              existing.push(threadLabel.labelId)
              threadSystemLabels.set(threadLabel.threadId, existing)
            }
          }

          // Log violations (server-side detection only, no correction)
          for (const [threadId, systemLabelIds] of threadSystemLabels.entries()) {
            if (systemLabelIds.length > 1) {
              const labelNames = systemLabelIds.map((id) => labels.find((l) => l.id === id)?.name || id)
              console.warn(
                `⚠️ BUSINESS RULE VIOLATION: Thread ${threadId} has multiple system labels: ${labelNames.join(', ')}`,
              )
            }
          }

          // Create a map to track expected counts per label
          const expectedCounts = new Map<string, number>()

          // Count how many threads each label should have
          for (const threadLabel of threadLabels) {
            const current = expectedCounts.get(threadLabel.labelId) || 0
            expectedCounts.set(threadLabel.labelId, current + 1)
          }

          // Check if any label counts need updating
          for (const label of labels) {
            const expectedCount = expectedCounts.get(label.id) || 0

            if (label.messageCount !== expectedCount) {
              console.log(`📊 Updating count for label ${label.name}: ${label.messageCount} → ${expectedCount}`)

              // Commit cross-aggregate event to update label count
              // Note: In a production system, you'd want more sophisticated
              // deduplication to avoid redundant updates
              store.commit(
                events.labelMessageCountUpdated({
                  labelId: label.id,
                  delta: expectedCount - label.messageCount,
                  updatedAt: new Date(),
                }),
              )
            }
          }
        },
      })

      this.storeSubscription = unsubscribe

      console.log(`✅ Cross-aggregate event subscriptions active`)
    }

    // Keep the Durable Object alive with periodic alarms
    await this.state.storage.setAlarm(Date.now() + 30000) // 30 seconds
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    // Re-initialize subscriptions after potential hibernation
    this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await this.subscribeToStore()
    await handleSyncUpdateRpc(payload)
  }
}

export default {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    const requestParamsResult = SyncBackend.getSyncRequestSearchParams(request)

    if (requestParamsResult._tag === 'Some') {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams: requestParamsResult.value,
        env: env as any,
        ctx,
        options: { headers: {} },
      })
    }

    // Forward request to client DO
    if (url.pathname.includes('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname === '/') {
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      return new Response('LiveStore Email Client Prototype with Cross-Aggregate Events') as CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
    return new Response('Not found', { status: 404 }) as CfTypes.Response
  },
} satisfies CfTypes.ExportedHandler<Env>

/// Helper functions

const storeIdFromRequest = (request: CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
