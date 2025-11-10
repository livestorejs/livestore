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
  private storeSubscription: Unsubscribe | undefined
  private threadSubscription: Unsubscribe | undefined
  private previousLabels = new Map<string, Set<string>>() // threadId -> labelIds
  private previousThreads = new Set<string>() // track which threads we've published

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
    if (this.storeSubscription || this.threadSubscription) return

    if (!this.store) throw new Error('Store not initialized. Call initialize() first.')

    // Subscribe to threadLabels table changes
    this.storeSubscription = this.store.subscribe(threadTables.threadLabels, async (threadLabels) => {
      await this.publishLabelChanges(threadLabels)
    })

    // Subscribe to thread table changes to detect new threads
    this.threadSubscription = this.store.subscribe(threadTables.thread, async (threads) => {
      await this.publishThreadCreated(threads)
    })
  }

  private async publishLabelChanges(
    currentLabels: ReadonlyArray<{ readonly threadId: string; readonly labelId: string; readonly appliedAt: Date }>,
  ) {
    try {
      // Group by threadId
      const currentMap = new Map<string, Set<string>>()
      for (const { threadId, labelId } of currentLabels) {
        if (!currentMap.has(threadId)) {
          currentMap.set(threadId, new Set())
        }
        currentMap.get(threadId)!.add(labelId)
      }

      // Detect changes for each thread
      for (const [threadId, currentLabelSet] of currentMap.entries()) {
        const previousLabelSet = this.previousLabels.get(threadId) || new Set()

        // Find added labels - publish v1.ThreadLabelApplied
        for (const labelId of currentLabelSet) {
          if (!previousLabelSet.has(labelId)) {
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

        // Find removed labels - publish v1.ThreadLabelRemoved
        for (const labelId of previousLabelSet) {
          if (!currentLabelSet.has(labelId)) {
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
      }

      // Update tracking
      this.previousLabels = currentMap
    } catch (error) {
      // Log and continue (per user preference)
      console.error('[ThreadClientDO] Failed to publish label changes:', error)
    }
  }

  private async publishThreadCreated(
    currentThreads: ReadonlyArray<{
      readonly id: string
      readonly subject: string
      readonly participants: string
      readonly createdAt: Date
    }>,
  ) {
    try {
      for (const thread of currentThreads) {
        // Only publish if this is a new thread we haven't seen before
        if (!this.previousThreads.has(thread.id)) {
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
          this.previousThreads.add(thread.id)
        }
      }
    } catch (error) {
      console.error('[ThreadClientDO] Failed to publish thread created:', error)
    }
  }

  alarm(): void | Promise<void> {
    // Re-initialize subscriptions after potential hibernation
    return this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await this.subscribeToStore()
    await handleSyncUpdateRpc(payload)
  }
}
