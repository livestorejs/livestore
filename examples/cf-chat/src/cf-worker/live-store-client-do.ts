import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import type { CfTypes } from '@livestore/sync-cf/common'
import { events, schema, tables } from '../livestore/schema.ts'
import type { Env } from './shared.ts'
import { storeIdFromRequest } from './shared.ts'

export class LiveStoreClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'livestore-client-do' as never
  private storeId: string | undefined
  private cachedStore: Store<typeof schema> | undefined
  private storeSubscription: Unsubscribe | undefined

  async fetch(request: Request): Promise<Response> {
    try {
      // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
      this.storeId = storeIdFromRequest(request)

      const store = await this.getStore()

      // Kick off subscription to store for bot functionality
      await this.subscribeToStore()

      const messages = store.query(tables.messages)
      const users = store.query(tables.users)
      const reactions = store.query(tables.reactions)
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

      return new Response(JSON.stringify({ messages, users, reactions, syncState }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
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
      durableObject: { ctx: this.ctx as CfTypes.DurableObjectState, env: this.env, bindingName: 'CLIENT_DO' },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      livePull: true,
    })

    this.cachedStore = store

    return store
  }

  async subscribeToStore() {
    const store = await this.getStore()

    // Make sure to only subscribe once
    if (this.storeSubscription === undefined) {
      const allMessagesQuery = tables.messages.where({})
      const unsubscribe = store.subscribe(allMessagesQuery, (messages) => {
        const processedMessageIds = new Set(
          store.query(tables.botProcessedMessages.where({})).map((processed) => processed.messageId),
        )
        const newUserMessages = messages.filter(
          (message) => !message.isBot && message.userId !== 'bot' && !processedMessageIds.has(message.id),
        )

        for (const message of newUserMessages) {
          console.log(`Bot: Reacting to new message ${message.id} from ${message.username}`)

          store.commit(
            events.reactionAdded({
              id: `bot-reaction-${message.id}`,
              messageId: message.id,
              emoji: '🤖',
              userId: 'bot',
              username: 'ChatBot',
            }),
          )

          store.commit(
            events.botProcessedMessage({
              messageId: message.id,
              processedAt: new Date(),
            }),
          )
        }
      })

      this.storeSubscription = unsubscribe
    }
  }

  async syncUpdateRpc(payload: unknown) {
    await this.subscribeToStore()
    await handleSyncUpdateRpc(payload)
  }
}
