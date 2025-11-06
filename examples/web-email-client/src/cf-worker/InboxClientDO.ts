import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { inboxEvents, schema as inboxSchema, inboxTables } from '../stores/inbox/schema.ts'
import { seedInbox } from '../stores/inbox/seed.ts'
import { threadEvents } from '../stores/thread/schema.ts'
import type { Env } from './shared.ts'

// Scoped by storeId
export class InboxClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  private store: Store<typeof inboxSchema> | undefined
  // private storeSubscription: Unsubscribe | undefined

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

  async updateLabelCount({ labelId, delta }: { labelId: string; delta: number }) {
    try {
      if (!this.store) {
        throw new Error('Store not initialized. Call initialize() first.')
      }

      // Query current count
      const label = this.store.query(inboxTables.labels.where({ id: labelId }))[0]

      if (!label) {
        console.warn(`[InboxClientDO] Label ${labelId} not found, skipping count update`)
        return
      }

      const newCount = Math.max(0, (label.threadCount || 0) + delta)

      // Commit count update event
      this.store.commit(
        inboxEvents.labelThreadCountUpdated({
          labelId,
          newCount,
          updatedAt: new Date(),
        }),
      )

      console.log(
        `[InboxClientDO] Updated label ${labelId} count: ${label.threadCount} -> ${newCount} (delta: ${delta})`,
      )
    } catch (error) {
      console.error('[InboxClientDO] Failed to update label count:', error)
      throw error // Propagate to queue consumer for retry
    }
  }

  async addThread({
    id,
    subject,
    participants,
    createdAt,
  }: {
    id: string
    subject: string
    participants: string[]
    createdAt: Date
  }) {
    try {
      if (!this.store) throw new Error('Store not initialized. Call initialize() first.')

      // Commit the thread creation event to Inbox store
      // The materializer will automatically update threadIndex table
      this.store.commit(
        inboxEvents.threadAdded({
          id,
          subject,
          participants,
          createdAt,
        }),
      )

      console.log(`[InboxClientDO] Added thread ${id} to threadIndex`)
    } catch (error) {
      console.error('[InboxClientDO] Failed to add thread:', error)
      throw error // Propagate to queue consumer for retry
    }
  }

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
