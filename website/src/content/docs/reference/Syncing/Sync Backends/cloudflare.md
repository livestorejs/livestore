---
title: 'Cloudflare Workers'
---

## Example

### Web adapter

In your `livestore.worker.ts` file, you can use the `makeWsSync` function to create a sync backend.

```ts
import { makeWsSync } from '@livestore/sync-cf'
import { makeWorker } from '@livestore/web/worker'

import { schema } from './livestore/schema.js'

const url = 'ws://localhost:8787'
// const url = 'https://websocket-server.your-user.workers.dev

makeWorker({
  schema,
  sync: { makeBackend: ({ storeId }) => makeWsSync({ url, storeId }) },
})

```

## How the sync backend works

- A Cloudflare worker is used to open a websocket connection between the client and a durable object.
- The durable object answers push/pull requests from the client.
- The events are stored in a D1 SQLite database with a table for each store instance following the pattern `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${storeId}` where `PERSISTENCE_FORMAT_VERSION` is a number that is incremented whenever the `sync-cf` internal storage format changes.

## Local development

You can run the sync backend locally by running `wrangler dev` (e.g. take a look at the `todomvc-sync-cf` example). The local D1 database can be found in `.wrangler/state/d1/miniflare-D1DatabaseObject/XXX.sqlite`.