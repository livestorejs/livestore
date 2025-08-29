---
title: 'Cloudflare Workers'
sidebar:
  order: 10
---

The `@livestore/sync-cf` package provides a comprehensive LiveStore sync provider for Cloudflare Workers using Durable Objects for WebSocket connections and D1 for event persistence. It supports multiple transport protocols to accommodate different deployment scenarios.

## Installation

```bash
pnpm add @livestore/sync-cf
```

## Transport Modes

The sync provider supports three transport protocols, each optimized for different use cases:

### WebSocket Transport (Recommended)

Real-time bidirectional communication with automatic reconnection and live pull support.

```ts
import { makeWsSync } from '@livestore/sync-cf/client'

const syncBackend = makeWsSync({ 
  url: 'wss://sync.example.com' 
})
```

### HTTP Transport

HTTP-based sync with polling for live updates. Requires the `enable_request_signal` compatibility flag.

```ts
import { makeHttpSync } from '@livestore/sync-cf/client'

const syncBackend = makeHttpSync({ 
  url: 'https://sync.example.com',
  livePull: {
    pollInterval: 3000, // Poll every 3 seconds
  }
})
```

### Durable Object RPC Transport

Direct RPC communication between Durable Objects (internal use by `@livestore/adapter-cloudflare`).

```ts
import { makeDoRpcSync } from '@livestore/sync-cf/client'

const syncBackend = makeDoRpcSync({
  syncBackendStub: syncBackendDurableObject,
  durableObjectContext: {
    bindingName: 'CLIENT_DO',
    durableObjectId: state.id.toString(),
  }
})
```

## Client API Reference

### `makeWsSync(options)`

Creates a WebSocket-based sync backend client.

**Options:**
- `url` - WebSocket URL (supports `ws`/`wss` or `http`/`https` protocols)
- `webSocketFactory?` - Custom WebSocket implementation
- `ping?` - Ping configuration:
  - `enabled?: boolean` - Enable/disable ping (default: `true`)
  - `requestTimeout?: Duration` - Ping timeout (default: 10 seconds)
  - `requestInterval?: Duration` - Ping interval (default: 10 seconds)

**Features:**
- Real-time live pull
- Automatic reconnection
- Connection status tracking
- Ping/pong keep-alive

```ts
const syncBackend = makeWsSync({
  url: 'wss://sync.example.com',
  ping: {
    enabled: true,
    requestTimeout: 5000,
    requestInterval: 15000,
  }
})
```

### `makeHttpSync(options)`

Creates an HTTP-based sync backend client with polling for live updates.

**Options:**
- `url` - HTTP endpoint URL
- `headers?` - Additional HTTP headers
- `livePull?` - Live pull configuration:
  - `pollInterval?: Duration` - Polling interval (default: 5 seconds)
- `ping?` - Ping configuration (same as WebSocket)

**Features:**
- HTTP request/response based
- Polling-based live pull
- Custom headers support
- Connection status via ping

```ts
const syncBackend = makeHttpSync({
  url: 'https://sync.example.com',
  headers: {
    'Authorization': 'Bearer token',
    'X-Custom-Header': 'value'
  },
  livePull: {
    pollInterval: 2000, // Poll every 2 seconds
  }
})
```

### `makeDoRpcSync(options)`

Creates a Durable Object RPC-based sync backend (for internal use).

**Options:**
- `syncBackendStub` - Durable Object stub implementing `SyncBackendRpcInterface`
- `durableObjectContext` - Context for RPC callbacks:
  - `bindingName` - Wrangler binding name for the client DO
  - `durableObjectId` - Client Durable Object ID

**Features:**
- Direct RPC communication
- Real-time live pull via callbacks
- Hibernation support

### `handleSyncUpdateRpc(payload)`

Handles RPC callback for live pull updates in Durable Objects.

```ts
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'

export class MyDurableObject extends DurableObject implements ClientDoWithRpcCallback {
  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }
}
```

## Server API Reference

### `makeDurableObject(options)`

Creates a sync backend Durable Object class.

**Options:**
- `onPush?` - Callback for push events: `(message, context) => void | Promise<void>`
- `onPushRes?` - Callback for push responses: `(message) => void | Promise<void>`
- `onPull?` - Callback for pull requests: `(message, context) => void | Promise<void>`
- `onPullRes?` - Callback for pull responses: `(message) => void | Promise<void>`
- `enabledTransports?` - Set of enabled transports: `Set<'http' | 'ws' | 'do-rpc'>`
- `otel?` - OpenTelemetry configuration:
  - `baseUrl?` - OTEL endpoint URL
  - `serviceName?` - Service name for traces

```ts
import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, { storeId, payload }) => {
    console.log(`Push to store ${storeId}:`, message.batch)
    
    // Custom business logic
    if (payload?.userId) {
      await notifyUser(payload.userId, message.batch)
    }
  },
  onPull: async (message, { storeId }) => {
    console.log(`Pull from store ${storeId}`)
  },
  enabledTransports: new Set(['ws', 'http']), // Disable DO RPC
  otel: {
    baseUrl: 'https://otel.example.com',
    serviceName: 'livestore-sync',
  }
}) {}
```

### `makeWorker(options)`

Creates a complete Cloudflare Worker for the sync backend.

**Options:**
- `validatePayload?` - Payload validation function: `(payload, context) => void | Promise<void>`
- `enableCORS?` - Enable CORS headers (default: `false`)
- `durableObject?` - Durable Object configuration:
  - `name?` - Binding name (default: `'SYNC_BACKEND_DO'`)

```ts
import { makeWorker } from '@livestore/sync-cf/cf-worker'

export default makeWorker({
  validatePayload: (payload, { storeId }) => {
    if (!payload?.authToken) {
      throw new Error('Missing auth token')
    }
    if (payload.authToken !== process.env.EXPECTED_TOKEN) {
      throw new Error('Invalid auth token')
    }
    console.log(`Validated connection for store: ${storeId}`)
  },
  enableCORS: true,
  durableObject: {
    name: 'SYNC_BACKEND_DO'
  }
})
```

### `handleSyncRequest(options)`

Handles sync backend HTTP requests in custom workers.

**Options:**
- `request` - The incoming request
- `searchParams` - Parsed sync request parameters
- `env` - Worker environment
- `ctx` - Worker execution context
- `options` - Additional options:
  - `headers?` - Response headers
  - `validatePayload?` - Payload validation function
  - `durableObject?` - DO configuration

```ts
import { handleSyncRequest, getSyncRequestSearchParams } from '@livestore/sync-cf/cf-worker'

export default {
  fetch: async (request, env, ctx) => {
    const requestParamsResult = getSyncRequestSearchParams(request)
    
    if (requestParamsResult._tag === 'Some') {
      return handleSyncRequest({
        request,
        searchParams: requestParamsResult.value,
        env,
        ctx,
        options: {
          headers: { 'X-Custom': 'header' },
          validatePayload: (payload, context) => {
            // Custom validation logic
          }
        },
      })
    }
    
    return new Response('Not found', { status: 404 })
  }
}
```

### `getSyncRequestSearchParams(request)`

Parses and validates sync request search parameters.

Returns an `Option` type: `Some` with valid parameters or `None` if not a sync request.

```ts
import { getSyncRequestSearchParams } from '@livestore/sync-cf/cf-worker'

const requestParamsResult = getSyncRequestSearchParams(request)
if (requestParamsResult._tag === 'Some') {
  const { storeId, payload, transport } = requestParamsResult.value
  console.log(`Sync request for store ${storeId} via ${transport}`)
}
```

## Configuration

### Wrangler Configuration

Configure your `wrangler.toml` for sync backend deployment:

```toml
name = "livestore-sync"
main = "./src/worker.ts"
compatibility_date = "2025-05-07"
compatibility_flags = [
  "enable_request_signal", # Required for HTTP streaming
]

[[durable_objects.bindings]]
name = "SYNC_BACKEND_DO"
class_name = "SyncBackendDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SyncBackendDO"]

[[d1_databases]]
binding = "DB"
database_name = "livestore-sync"
database_id = "your-database-id"

[vars]
ADMIN_SECRET = "your-admin-secret"
```

### Environment Variables

Required environment bindings:

```ts
interface Env {
  DB: D1Database                    // Event storage
  ADMIN_SECRET: string             // Admin authentication
  SYNC_BACKEND_DO: DurableObjectNamespace<SyncBackendDO>
}
```

## Transport Protocol Details

### WebSocket Protocol
- **Path**: `/sync?storeId=...&transport=ws`
- **Features**: Real-time bidirectional, automatic reconnection
- **Use case**: Interactive applications, real-time collaboration

### HTTP Protocol
- **Path**: `/sync?storeId=...&transport=http`
- **Features**: Request/response, polling for live updates
- **Use case**: Mobile apps, intermittent connectivity

### DO RPC Protocol
- **Internal**: Direct RPC calls between Durable Objects
- **Features**: Lowest latency, hibernation support
- **Use case**: Server-side processing, Durable Object adapters

## Data Storage

Events are stored in D1 SQLite with tables following the pattern:
```
eventlog_{PERSISTENCE_FORMAT_VERSION}_{storeId}
```

The persistence format version is automatically managed and incremented when the storage schema changes.

## Deployment

Deploy to Cloudflare Workers:

```bash
# Deploy the worker
npx wrangler deploy

# Create D1 database
npx wrangler d1 create livestore-sync

# Run migrations if needed
npx wrangler d1 migrations apply livestore-sync
```

## Local Development

Run locally with Wrangler:

```bash
# Start local development server
npx wrangler dev

# Access local D1 database
# Located at: .wrangler/state/d1/miniflare-D1DatabaseObject/XXX.sqlite
```

## Examples

### Basic WebSocket Client

```ts
import { makeWsSync } from '@livestore/sync-cf/client'
import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from './schema.js'

makeWorker({
  schema,
  sync: { 
    backend: makeWsSync({ 
      url: 'wss://sync.example.com' 
    }) 
  },
})
```

### Custom Worker with Authentication

```ts
import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, { storeId, payload }) => {
    // Log all sync events
    console.log(`Store ${storeId} received ${message.batch.length} events`)
  },
}) {}

export default makeWorker({
  validatePayload: (payload, { storeId }) => {
    if (!payload?.userId) {
      throw new Error('User ID required')
    }
    
    // Validate user has access to store
    if (!hasStoreAccess(payload.userId, storeId)) {
      throw new Error('Unauthorized access to store')
    }
  },
  enableCORS: true,
})
```

### Multi-Transport Setup

```ts
export class SyncBackendDO extends makeDurableObject({
  // Enable all transport modes
  enabledTransports: new Set(['http', 'ws', 'do-rpc']),
  
  onPush: async (message, context) => {
    const transport = getTransportFromContext(context)
    console.log(`Push via ${transport}:`, message.batch.length)
  },
}) {}
```