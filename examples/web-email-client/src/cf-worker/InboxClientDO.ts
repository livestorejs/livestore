import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { schema as inboxSchema, inboxTables } from '../stores/inbox/schema.ts'
import { seedInbox } from '../stores/inbox/seed.ts'
import type { Env } from './shared.ts'

// Scoped by storeId
export class InboxClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  private store: Store<typeof inboxSchema> | undefined
  // private storeSubscription: Unsubscribe | undefined

  fetch = async (): Promise<Response> => new Response('InboxClientDO is alive', { status: 200 })

  async initialize({ storeId }: { storeId: string }) {
    if (this.store !== undefined) return

    this.store = await createStoreDoPromise({
      schema: inboxSchema,
      storeId,
      clientId: 'inbox-client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as SyncBackend.CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'INBOX_CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.getByName(storeId),
      livePull: true,
    })

    // Check if seeding has already been done by looking for system labels
    const existingLabelCount = this.store.query(inboxTables.labels.count())

    if (existingLabelCount > 0) {
      console.log('📧 Inbox store already seeded with', existingLabelCount, 'labels')
      return
    }

    const { inboxLabelId } = seedInbox(this.store)

    const threadId = nanoid()

    const threadDoStub = this.env.THREAD_CLIENT_DO.getByName(`thread-${threadId}`)
    await threadDoStub.initialize({ threadId, inboxLabelId })
  }

  // async subscribeToStore() {
  //   const store = await this.getStore()
  //
  //   // Make sure to only subscribe once
  //   if (this.storeSubscription === undefined) {
  //     console.log(`📧 Setting up cross-aggregate event subscriptions...`)
  //
  //     // Subscribe to ThreadLabel events to implement cross-aggregate reactions
  //     // This demonstrates the core architecture requirement: when thread labels change,
  //     // the label message counts need to be updated automatically
  //     const unsubscribe = store.subscribe(threadLabelsQuery, {
  //       onUpdate: (threadLabels) => {
  //         console.log(`🏷️ Thread labels updated, checking for cross-aggregate updates needed`)
  //
  //         // Get current labels to identify system labels
  //         const labels = store.query(inboxTables.labels.where({}))
  //         const systemLabels = labels.filter((l) => l.type === 'system')
  //         const systemLabelIds = new Set(systemLabels.map((l) => l.id))
  //
  //         // BUSINESS RULE: Enforce "one system label per thread"
  //         const threadSystemLabels = new Map<string, string[]>()
  //         for (const threadLabel of threadLabels) {
  //           if (systemLabelIds.has(threadLabel.labelId)) {
  //             const existing = threadSystemLabels.get(threadLabel.threadId) || []
  //             existing.push(threadLabel.labelId)
  //             threadSystemLabels.set(threadLabel.threadId, existing)
  //           }
  //         }
  //
  //         // Log violations (server-side detection only, no correction)
  //         for (const [threadId, systemLabelIds] of threadSystemLabels.entries()) {
  //           if (systemLabelIds.length > 1) {
  //             const labelNames = systemLabelIds.map((id) => labels.find((l) => l.id === id)?.name || id)
  //             console.warn(
  //               `⚠️ BUSINESS RULE VIOLATION: Thread ${threadId} has multiple system labels: ${labelNames.join(', ')}`,
  //             )
  //           }
  //         }
  //
  //         // Create a map to track expected counts per label
  //         const expectedCounts = new Map<string, number>()
  //
  //         // Count how many threads each label should have
  //         for (const threadLabel of threadLabels) {
  //           const current = expectedCounts.get(threadLabel.labelId) || 0
  //           expectedCounts.set(threadLabel.labelId, current + 1)
  //         }
  //
  //         // Check if any label counts need updating
  //         for (const label of labels) {
  //           const expectedCount = expectedCounts.get(label.id) || 0
  //
  //           if (label.messageCount !== expectedCount) {
  //             console.log(`📊 Updating count for label ${label.name}: ${label.messageCount} → ${expectedCount}`)
  //
  //             // Commit cross-aggregate event to update label count
  //             // Note: In a production system, you'd want more sophisticated
  //             // deduplication to avoid redundant updates
  //             store.commit(
  //               events.labelMessageCountUpdated({
  //                 labelId: label.id,
  //                 newCount: expectedCount,
  //                 updatedAt: new Date(),
  //               }),
  //             )
  //           }
  //         }
  //       },
  //     })
  //
  //     this.storeSubscription = unsubscribe
  //
  //     console.log(`✅ Cross-aggregate event subscriptions active`)
  //   }
  //
  //   // Keep the Durable Object alive with periodic alarms
  //   await this.state.storage.setAlarm(Date.now() + 30000) // 30 seconds
  // }

  // alarm(): void | Promise<void> {
  //   Re-initialize subscriptions after potential hibernation
  // return this.subscribeToStore()
  // }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    // await this.subscribeToStore()
    await handleSyncUpdateRpc(payload)
  }
}
