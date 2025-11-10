import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { mailboxEvents, schema as mailboxSchema, mailboxTables } from '../stores/mailbox/schema.ts'
import { seedMailbox } from '../stores/mailbox/seed.ts'
import type { Env } from './shared.ts'

export class MailboxClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  private store: Store<typeof mailboxSchema> | undefined

  async initialize({ storeId }: { storeId: string }) {
    if (this.store !== undefined) return

    this.store = await createStoreDoPromise({
      schema: mailboxSchema,
      storeId,
      clientId: 'mailbox-client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as SyncBackend.CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'MAILBOX_CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.getByName(storeId),
      livePull: true,
    })

    // Check if seeding has already been done by looking for system labels
    const existingLabelCount = this.store.query(mailboxTables.labels.count())

    if (existingLabelCount > 0) {
      console.log('📧 Mailbox store already seeded with', existingLabelCount, 'labels')
      return
    }

    const { inboxLabelId } = seedMailbox(this.store)

    const threadId = nanoid()

    const threadDoStub = this.env.THREAD_CLIENT_DO.getByName(`thread-${threadId}`)
    await threadDoStub.initialize({ threadId, inboxLabelId })
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

      // Commit the thread creation event to Mailbox store
      // The materializer will automatically update threadIndex table
      this.store.commit(
        mailboxEvents.threadAdded({
          id,
          subject,
          participants,
          createdAt,
        }),
      )

      console.log(`[MailboxClientDO] Added thread ${id} to threadIndex`)
    } catch (error) {
      console.error('[MailboxClientDO] Failed to add thread:', error)
      throw error
    }
  }

  async applyThreadLabel({ threadId, labelId, appliedAt }: { threadId: string; labelId: string; appliedAt: Date }) {
    try {
      if (!this.store) throw new Error('Store not initialized. Call initialize() first.')

      // Commit event - materializer will update threadLabels AND increment count
      this.store.commit(
        mailboxEvents.threadLabelApplied({
          threadId,
          labelId,
          appliedAt,
        }),
      )

      console.log(`[MailboxClientDO] Applied label ${labelId} to thread ${threadId}`)
    } catch (error) {
      console.error('[MailboxClientDO] Failed to apply thread label:', error)
      throw error
    }
  }

  async removeThreadLabel({ threadId, labelId, removedAt }: { threadId: string; labelId: string; removedAt: Date }) {
    try {
      if (!this.store) throw new Error('Store not initialized. Call initialize() first.')

      // Commit event - materializer will remove from threadLabels AND decrement count
      this.store.commit(
        mailboxEvents.threadLabelRemoved({
          threadId,
          labelId,
          removedAt,
        }),
      )

      console.log(`[MailboxClientDO] Removed label ${labelId} from thread ${threadId}`)
    } catch (error) {
      console.error('[MailboxClientDO] Failed to remove thread label:', error)
      throw error
    }
  }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await handleSyncUpdateRpc(payload)
  }
}
