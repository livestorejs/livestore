---
title: Node Adapter
sidebar:
  order: 2
---

Works with Node.js, Bun and Deno.

## Example

```ts
import { makeAdapter } from '@livestore/adapter-node'

const adapter = makeAdapter({
	storage: { type: 'fs' },
	// or in-memory:
	// storage: { type: 'in-memory' },
	sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
	// To enable devtools:
	// devtools: { schemaPath: new URL('./schema.ts', import.meta.url) },
})
```

## Resetting local persistence

During development you can instruct the adapter to wipe the locally persisted state and eventlog databases on startup:

```ts
import { makeAdapter } from '@livestore/adapter-node'

const resetPersistence = process.env.NODE_ENV !== 'production' && Boolean(process.env.RESET_LIVESTORE)

const adapter = makeAdapter({
        storage: { type: 'fs' },
        resetPersistence,
})
```

:::caution
This will delete all local data for the given `storeId` and `clientId`. It only clears local persistence and does not reset any connected sync backend. Only enable it for debugging scenarios.
:::

### Worker adapter

The worker adapter can be used for more advanced scenarios where it's preferable to reduce the load of the main thread and run persistence/syncing in a worker thread.

```ts
// main.ts
import { makeWorkerAdapter } from '@livestore/adapter-node'

const adapter = makeWorkerAdapter({
	workerUrl: new URL('./livestore.worker.js', import.meta.url),
})

// livestore.worker.ts
import { makeWorker } from '@livestore/adapter-node/worker'

const adapter = makeAdapter({
	storage: { type: 'fs' },
	// or in-memory:
	// storage: { type: 'in-memory' },
	sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
})
```
