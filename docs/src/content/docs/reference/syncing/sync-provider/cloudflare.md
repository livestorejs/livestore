---
title: 'Cloudflare Workers'
sidebar:
  order: 10
---

The `@livestore/sync-cf` package provides a LiveStore sync provider targeting Cloudflare Workers using Durable Objects (for websocket connections) and D1 (for persisting events).

## Example

### Using the web adapter

In your `livestore.worker.ts` file, you can use the `makeCfSync` function to create a sync backend.

```ts
import { makeCfSync } from '@livestore/sync-cf'
import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './livestore/schema.js'

const url = 'ws://localhost:8787'
// const url = 'https://websocket-server.your-user.workers.dev

makeWorker({
  schema,
  sync: { backend: makeCfSync({ url }) },
})
```

### Cloudflare Worker

In your CF worker file, you can use the `makeDurableObject` and `makeWorker` functions to create a sync backend.

```ts
import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class WebSocketServer extends makeDurableObject({
  onPush: async (message) => {
    console.log('onPush', message.batch)
  },
  onPull: async (message) => {
    console.log('onPull', message)
  },
}) {}

export default makeWorker({
  validatePayload: (payload: any, context) => {
    if (payload?.authToken !== 'insecure-token-change-me') {
      throw new Error('Invalid auth token')
    }
  },
})

```

#### Custom Cloudflare Worker handling

If you want to embed the sync backend request handler in your own Cloudflare worker, you can do so by using the `handleWebSocket` function for the `/websocket` endpoint.

```ts
import { handleWebSocket } from '@livestore/sync-cf/cf-worker'

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/websocket')) {
      return handleWebSocket(request, env, ctx, {
        validatePayload: (payload: any, context) => {
          if (payload?.authToken !== 'insecure-token-change-me') {
            throw new Error('Invalid auth token')
          }
        },
      })
    }

    return new Response('Invalid path', { status: 400 })
  },
}
```

## Deployment

The sync backend can be deployed to Cloudflare using the following command:

```bash
wrangler deploy
```

## How the sync backend works

- A Cloudflare worker is used to open a websocket connection between the client and a durable object.
- The durable object answers push/pull requests from the client.
- The events are stored in a D1 SQLite database with a table for each store instance following the pattern `eventlog_${PERSISTENCE_FORMAT_VERSION}_${storeId}` where `PERSISTENCE_FORMAT_VERSION` is a number that is incremented whenever the `sync-cf` internal storage format changes.

## Local development

You can run the sync backend locally by running `wrangler dev` (e.g. take a look at the `todomvc-sync-cf` example). The local D1 database can be found in `.wrangler/state/d1/miniflare-D1DatabaseObject/XXX.sqlite`.
