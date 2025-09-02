---
title: Cloudflare Durable Object Adapter
sidebar:
  order: 20
---

The Cloudflare Durable Object adapter enables running LiveStore applications on Cloudflare Workers with stateful Durable Objects for synchronized real-time data.

## Installation

```bash
pnpm add @livestore/adapter-cloudflare @livestore/sync-cf
```

## Configuration

### Wrangler Configuration

Configure your `wrangler.toml` with the required Durable Object bindings:

```toml
name = "my-livestore-app"
main = "./src/worker.ts"
compatibility_date = "2025-05-07"
compatibility_flags = [
  "enable_request_signal", # Required for HTTP RPC streams
]

[[durable_objects.bindings]]
name = "SYNC_BACKEND_DO"
class_name = "SyncBackendDO"

[[durable_objects.bindings]]
name = "CLIENT_DO"
class_name = "LiveStoreClientDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SyncBackendDO", "LiveStoreClientDO"]

[[d1_databases]]
binding = "DB"
database_name = "my-livestore-db"
database_id = "your-database-id"
```

### Environment Types

Define your environment bindings:

```ts
import type { ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'

type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  DB: D1Database
  ADMIN_SECRET: string
}
```

## Basic Setup

### 1. Create Sync Backend Durable Object

The sync backend handles data synchronization across clients:

```ts
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  // Optional: Handle push events
  // onPush: async (message, { storeId }) => {
  //   console.log(`onPush for store (${storeId})`, message.batch)
  // },
}) {}
```

### 2. Create Client Durable Object

The client Durable Object manages individual LiveStore instances:

```ts
import { DurableObject } from 'cloudflare:workers'
import { createStoreDoPromise, type ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { schema, tables } from './schema.ts'

export class LiveStoreClientDO extends DurableObject implements ClientDoWithRpcCallback {
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
    this.storeId = getStoreIdFromRequest(request)
    const store = await this.getStore()
    
    // Start subscription to store updates
    await this.subscribeToStore()
    
    const data = store.query(tables.yourTable)
    return new Response(JSON.stringify(data))
  }

  private async getStore() {
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
      storage: this.state.storage,
      syncBackendDurableObject: this.env.SYNC_BACKEND_DO.get(
        this.env.SYNC_BACKEND_DO.idFromName(storeId)
      ),
      livePull: true, // Enable real-time updates
    })

    this.cachedStore = store
    return store
  }

  async subscribeToStore() {
    const store = await this.getStore()
    
    if (this.storeSubscription === undefined) {
      this.storeSubscription = store.subscribe(tables.yourTable, {
        onUpdate: (data) => {
          console.log(`Data updated for store (${this.storeId})`, data)
        },
      })
    }

    // Keep DO alive with periodic alarms
    await this.state.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.subscribeToStore()
  }

  // Required for sync backend RPC callbacks
  async syncUpdateRpc(payload: unknown) {
    // Make sure to wake up the store before processing the sync update
    await this.getStore()
    await handleSyncUpdateRpc(payload)
  }
}
```

### 3. Worker Fetch Handler

Handle incoming requests and route to appropriate Durable Objects:

```ts
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export default {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    // Handle sync backend requests
    const requestParamsResult = SyncBackend.getSyncRequestSearchParams(request)
    if (requestParamsResult._tag === 'Some') {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams: requestParamsResult.value,
        env,
        ctx,
        options: { headers: {} },
      })
    }

    // Route to client Durable Object
    if (url.pathname.endsWith('/client-do')) {
      const storeId = getStoreIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)
      return env.CLIENT_DO.get(id).fetch(request)
    }

    return new Response('Not found', { status: 404 })
  },
} satisfies CfTypes.ExportedHandler<Env>
```

## API Reference

### `createStoreDoPromise(options)`

Creates a LiveStore instance within a Durable Object.

**Options:**
- `schema` - LiveStore schema definition
- `storeId` - Unique identifier for the store
- `clientId` - Client identifier
- `sessionId` - Session identifier (use `nanoid()`)
- `durableObjectId` - Durable Object ID as string
- `bindingName` - Name of the client DO binding
- `storage` - Durable Object storage instance
- `syncBackendDurableObject` - Sync backend DO stub
- `livePull` - Enable real-time updates (default: `false`)

### `syncUpdateRpc(payload)`

**Required method for Client Durable Objects**

This method must be implemented on your Client Durable Object to handle sync update notifications from the sync backend:

```ts
async syncUpdateRpc(payload: unknown) {
  await handleSyncUpdateRpc(payload)
}
```

**Parameters:**
- `payload` - Sync update notification payload from the sync backend

**Purpose:**
- Enables real-time sync updates when using `livePull: true`
- Called by the sync backend Durable Object when new events are available
- Must delegate to `handleSyncUpdateRpc` from `@livestore/sync-cf/client`

**Implementation Notes:**
- This is part of the RPC interface between sync backend and client DOs
- The method signature must match exactly for the RPC system to work
- Always use the provided `handleSyncUpdateRpc` function - don't implement custom logic

For sync backend-related APIs like `makeDurableObject`, `handleSyncRequest`, and `getSyncRequestSearchParams`, see the [Cloudflare sync provider documentation](/reference/syncing/sync-provider/cloudflare/).

## Advanced Features

### Live Pull

Enable real-time data synchronization by setting `livePull: true` in `createStoreDoPromise`:

```ts
const store = await createStoreDoPromise({
  // ... other options
  livePull: true, // Enables real-time updates
})
```

### Store Subscriptions

Subscribe to data changes within your Durable Object:

```ts
const subscription = store.subscribe(tables.yourTable, {
  onUpdate: (data) => {
    // Handle data updates
    console.log('Data changed:', data)
  },
})

// Don't forget to unsubscribe when done
subscription()
```

### Durable Object Lifecycle Management

#### Hibernation-Aware Design

Design your Durable Objects to handle hibernation gracefully:

```ts
export class LiveStoreClientDO extends DurableObject {
  private cachedStore: Store<typeof schema> | undefined
  
  async initializeIfNeeded() {
    if (this.cachedStore) return
    
    // Re-establish store and subscriptions after hibernation
    this.cachedStore = await this.getStore()
    await this.subscribeToStore()
  }
  
  async fetch(request: Request): Promise<Response> {
    await this.initializeIfNeeded()
    // ... handle request
  }
}
```

#### Alarm-Based Keep-Alive (Optional)

:::caution[CPU Billing Impact]
Using alarms to keep DOs alive prevents hibernation and increases CPU billing. Only use this pattern if you need guaranteed real-time responsiveness and understand the cost implications.
:::

If you need to maintain active subscriptions between requests, you can use alarms as a last resort:

```ts
async subscribeToStore() {
  if (this.storeSubscription === undefined) {
    const store = await this.getStore()
    
    this.storeSubscription = store.subscribe(tables.messages, {
      onUpdate: (messages) => {
        // Process real-time updates
        this.broadcastToClients(messages)
      },
    })
  }

  // Only schedule alarm if absolutely necessary for your use case
  // Consider longer intervals (5+ minutes) to minimize CPU costs
  const nextAlarm = Date.now() + (5 * 60 * 1000) // 5 minutes
  await this.state.storage.setAlarm(nextAlarm)
}

alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
  // Re-initialize after potential hibernation
  this.cachedStore = undefined
  this.subscribeToStore()
}
```

**Alternative approaches to consider:**
- Let DOs hibernate naturally and re-initialize on demand
- Use WebSockets or EventSource for real-time updates to client browsers
- Implement request-driven sync instead of continuous subscriptions

#### Error Handling and Recovery

Implement robust error handling for DO operations:

```ts
async fetch(request: Request): Promise<Response> {
  try {
    await this.initializeIfNeeded()
    
    const store = await this.getStore()
    const data = store.query(tables.yourTable)
    
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('DO operation failed:', error)
    
    // Reset state on critical errors
    if (error.message.includes('database')) {
      this.cachedStore = undefined
    }
    
    return new Response('Internal Server Error', { status: 500 })
  }
}
```

## Complete Example

See the full [cloudflare-todomvc example](https://github.com/livestore/cloudflare-adapter/tree/main/examples/cloudflare-todomvc) for a complete implementation including schema definition, event handling, and UI integration.

## Deployment

Deploy to Cloudflare Workers:

```bash
npx wrangler deploy
```

Make sure to set up your D1 database and configure the `ADMIN_SECRET` environment variable in the Cloudflare dashboard.