import { DurableObject } from 'cloudflare:workers'

import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'

import { schema as threadSchema, threadTables } from '../stores/thread/schema.ts'
import { seedThread } from '../stores/thread/seed.ts'
import { encodeThreadEvent, type Env, type ThreadCrossStoreEvent } from './shared.ts'

// Scoped by storeId
export class ThreadClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'thread-client-do' as never
  private store!: Store<typeof threadSchema>
  private hasStore = false
  private eventsListenerStarted = false

  async initialize({ threadId, inboxLabelId }: { threadId: string; inboxLabelId: string }) {
    if (this.hasStore === true) return

    const storeId = `thread-${threadId}`

    this.store = await createStoreDoPromise({
      schema: threadSchema,
      storeId,
      clientId: 'thread-client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'THREAD_CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.getByName(storeId),
      livePull: true,
    })
    this.hasStore = true

    // Check if seeding has already been done by looking for existing threads
    const existingThreadCount = this.store.query(threadTables.thread.count())

    if (existingThreadCount > 0) {
      console.log('📧 Thread store already seeded with', existingThreadCount, 'thread')
      this.startEventsListener()
      return
    }

    seedThread({ store: this.store, threadId, inboxLabelId })
    this.startEventsListener()
  }

  /** Listens to the store event stream and publishes cross-store events. */
  private startEventsListener() {
    if (this.eventsListenerStarted) return
    if (this.hasStore === false) throw new Error('Store not initialized. Call initialize() first.')
    this.eventsListenerStarted = true

    const publishEvents = async () => {
      const eventStream = this.store.events({
        filter: ['v1.ThreadCreated', 'v1.ThreadLabelApplied', 'v1.ThreadLabelRemoved'],
      })

      for await (const threadEvent of eventStream) {
        // The filter above narrows at runtime but doesn't narrow the type of `threadEvent`
        const crossStoreEvent = encodeThreadEvent(threadEvent as ThreadCrossStoreEvent)
        await this.env.CROSS_STORE_EVENTS_QUEUE.send(crossStoreEvent)
        console.log(`📤 Published ${crossStoreEvent.name} cross-store event`)
      }
    }

    // Run in the background — the async iterator will keep yielding as new events arrive
    publishEvents().catch((error) => {
      console.error('[ThreadClientDO] Events listener failed:', error)
      this.eventsListenerStarted = false
    })
  }

  async syncUpdateRpc(payload: unknown) {
    // Re-establish the events listener in case the DO hibernated since the last call
    this.startEventsListener()
    await handleSyncUpdateRpc(payload)
  }
}
