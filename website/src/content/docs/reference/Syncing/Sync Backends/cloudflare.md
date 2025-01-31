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

const url = 'ws://localhost:8787/websocket'

makeWorker({
  schema,
  sync: { makeBackend: ({ storeId }) => makeWsSync({ url, storeId }) },
})

```
