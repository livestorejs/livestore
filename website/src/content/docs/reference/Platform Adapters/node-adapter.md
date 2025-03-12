---
title: Node Adapter
---

Works with Node.js, Bun and Deno.

## Example

```ts
import { makeNodeAdapter } from '@livestore/adapter-node'

const adapter = makeNodeAdapter({
	schemaPath: new URL('./schema.ts', import.meta.url),
	workerUrl: new URL('./livestore.worker.js', import.meta.url),
})
```
