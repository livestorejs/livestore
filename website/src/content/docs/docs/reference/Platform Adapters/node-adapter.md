---
title: Node Adapter
sidebar:
  order: 2
---

Works with Node.js, Bun and Deno.

## Example

```ts
import { makePersistedAdapter } from '@livestore/adapter-node'

const adapter = makePersistedAdapter({
	schemaPath: new URL('./schema.ts', import.meta.url),
	workerUrl: new URL('./livestore.worker.js', import.meta.url),
})
```
