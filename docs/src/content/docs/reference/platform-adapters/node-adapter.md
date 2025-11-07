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
	sync: { backend: makeCfSync({ url: 'ws://localhost:8787' }) },
	// To enable devtools:
	// devtools: { schemaPath: new URL('./schema.ts', import.meta.url) },
})
```

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
import { schema } from './schema/index.js'

makeWorker({ schema })
```
