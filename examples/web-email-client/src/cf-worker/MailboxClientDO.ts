import { DurableObject } from 'cloudflare:workers'

import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'

import { schema as mailboxSchema, mailboxTables } from '../stores/mailbox/schema.ts'
import { seedMailbox } from '../stores/mailbox/seed.ts'
import { CrossStoreEventSchema, decodeCrossStoreEvent, type Env } from './shared.ts'

export class MailboxClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'mailbox-client-do' as never
  private store!: Store<typeof mailboxSchema>
  private hasStore = false

  async initialize({ storeId }: { storeId: string }) {
    if (this.hasStore === true) return

    this.store = await createStoreDoPromise({
      schema: mailboxSchema,
      storeId,
      clientId: 'mailbox-client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'MAILBOX_CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.getByName(storeId),
      livePull: true,
    })
    this.hasStore = true

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

  async handleCrossStoreEvent(crossStoreEvent: typeof CrossStoreEventSchema.Encoded) {
    if (this.hasStore === false) throw new Error('Store not initialized. Call initialize() first.')

    const mailboxEvent = decodeCrossStoreEvent(crossStoreEvent)
    this.store.commit(mailboxEvent)
    console.log(`[MailboxClientDO] Committed ${mailboxEvent.name} event`)
  }

  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await handleSyncUpdateRpc(payload)
  }
}
