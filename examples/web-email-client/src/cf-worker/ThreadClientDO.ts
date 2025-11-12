import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { schema as threadSchema, threadTables } from '../stores/thread/schema.ts'
import { seedThread } from '../stores/thread/seed.ts'
import type { Env } from './shared.ts'

// Scoped by storeId
export class ThreadClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  private store: Store<typeof threadSchema> | undefined
  private threadLabelsSubscription: Unsubscribe | undefined
  private threadSubscription: Unsubscribe | undefined
  private previousLabels: ReadonlyArray<{
    readonly threadId: string
    readonly labelId: string
    readonly appliedAt: Date
  }> = [] // labels for the single thread in this store
  private threadPublished = false // track if we've published the thread creation event

  async initialize({ threadId, inboxLabelId }: { threadId: string; inboxLabelId: string }) {
    if (this.store !== undefined) return

    const storeId = `thread-${threadId}`

    this.store = await createStoreDoPromise({
      schema: threadSchema,
      storeId,
      clientId: 'thread-client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as SyncBackend.CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'THREAD_CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.getByName(storeId),
      livePull: true,
    })

    // Check if seeding has already been done by looking for existing threads
    const existingThreadCount = this.store.query(threadTables.thread.count())

    if (existingThreadCount > 0) {
      console.log('📧 Thread store already seeded with', existingThreadCount, 'thread')
      await this.subscribeToStore()
      return
    }

    seedThread({ store: this.store, threadId, inboxLabelId })
    await this.subscribeToStore()
  }

  private async subscribeToStore() {
    if (this.threadLabelsSubscription || this.threadSubscription) return

    if (!this.store) throw new Error('Store not initialized. Call initialize() first.')

    // Subscribe to threadLabels table changes to detect label applications/removals
    this.threadLabelsSubscription = this.store.subscribe(threadTables.threadLabels, this.publishLabelChanges)

    // Subscribe to thread table changes to detect new threads
    this.threadSubscription = this.store.subscribe(threadTables.thread, this.publishThreadCreated)
  }

  private publishLabelChanges = async (
    currentLabels: ReadonlyArray<{ readonly threadId: string; readonly labelId: string; readonly appliedAt: Date }>,
  ) => {
    try {
      // Find removed labels - publish v1.ThreadLabelRemoved
      for (const { threadId, labelId } of this.previousLabels) {
        if (!currentLabels.some((curr) => curr.labelId === labelId)) {
          await this.env.CROSS_STORE_EVENTS_QUEUE.send({
            name: 'v1.ThreadLabelRemoved',
            data: {
              threadId,
              labelId,
              removedAt: new Date(),
            },
          })
          console.log(`📤 Published v1.ThreadLabelRemoved: thread=${threadId}, label=${labelId}`)
        }
      }

      // Find added labels - publish v1.ThreadLabelApplied
      for (const { threadId, labelId } of currentLabels) {
        if (!this.previousLabels.some((prev) => prev.labelId === labelId)) {
          await this.env.CROSS_STORE_EVENTS_QUEUE.send({
            name: 'v1.ThreadLabelApplied',
            data: {
              threadId,
              labelId,
              appliedAt: new Date(),
            },
          })
          console.log(`📤 Published v1.ThreadLabelApplied: thread=${threadId}, label=${labelId}`)
        }
      }

      // Store current state for next comparison
      this.previousLabels = currentLabels
    } catch (error) {
      // Log and continue (per user preference)
      console.error('[ThreadClientDO] Failed to publish label changes:', error)
    }
  }

  private publishThreadCreated = async (
    currentThreads: ReadonlyArray<{
      readonly id: string
      readonly subject: string
      readonly participants: string
      readonly createdAt: Date
    }>,
  ) => {
    try {
      // Since this store manages a single thread, we only publish once
      if (this.threadPublished || currentThreads.length === 0) {
        return
      }

      // There should only be one thread in this store, but we'll handle it gracefully
      const thread = currentThreads[0]
      await this.env.CROSS_STORE_EVENTS_QUEUE.send({
        name: 'v1.ThreadCreated',
        data: {
          id: thread.id,
          subject: thread.subject,
          participants: JSON.parse(thread.participants), // Convert back to array
          createdAt: thread.createdAt,
        },
      })
      console.log(`📤 Published v1.ThreadCreated: thread=${thread.id}`)
      this.threadPublished = true
    } catch (error) {
      console.error('[ThreadClientDO] Failed to publish thread created:', error)
    }
  }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await this.subscribeToStore()
    await handleSyncUpdateRpc(payload)
  }
}
