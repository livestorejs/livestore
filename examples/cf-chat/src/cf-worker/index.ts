/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import { DurableObject } from 'cloudflare:workers'
// import type { AlarmInvocationInfo, D1Database, DurableObjectState } from "@cloudflare/workers-types";
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, queryDb, Schema, type Store, type Unsubscribe } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { events, schema, tables } from '../livestore/schema.ts'

type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  SYNC_BACKEND_URL: string
  DB: D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, { storeId }) => {
    console.log(`onPush for store (${storeId})`, message.batch)
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

    return store
  }

  async subscribeToStore() {
    const store = await this.getStore()

    // Make sure to only subscribe once
    if (this.storeSubscription === undefined) {
      // this.storeSubscription = store.subscribe(events.userJoined, {
      // 	onUpdate: (event) => {
      // 		console.log(`Bot: User ${event.username} joined!`);

      // 		// Welcome message from bot
      // 		store.commit(
      // 			events.messageCreated({
      // 				id: crypto.randomUUID(),
      // 				text: `Welcome to the chat, ${event.username}! 👋`,
      // 				userId: "bot",
      // 				username: "ChatBot",
      // 				timestamp: new Date(),
      // 				isBot: true,
      // 			}),
      // 		);
      // 	},
      // });

      // Subscribe to messages for bot reactions
      const messagesWithoutReactions = queryDb({
        query: `
          SELECT * FROM messages
          WHERE id NOT IN (SELECT messageId FROM reactions)
        `,
        schema: tables.messages.rowSchema.pipe(Schema.Array),
      })

      const unsubscribe = store.subscribe(messagesWithoutReactions, {
        onUpdate: (messages) => {
          console.log('messages', messages)
          // Bot reacts to user messages (not its own)
          for (const message of messages) {
            if (!message.isBot) {
              console.log(`Bot: Reacting to message from ${message.username}`)

              // setTimeout(() => {
              store.commit(
                events.reactionAdded({
                  id: crypto.randomUUID(),
                  messageId: message.id,
                  emoji: '👍',
                  userId: 'bot',
                  username: 'ChatBot',
                }),
              )
              // }, 10);
            }
          }
        },
      })

      this.storeSubscription = unsubscribe
    }

    // Make sure the DO stays alive
    await this.state.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
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
      return new Response('LiveStore Chat App with CF DO Bot') as CfTypes.Response
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
