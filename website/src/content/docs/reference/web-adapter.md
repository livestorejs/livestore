---
title: Web adapter
description: Information about LiveStore's web adapter
---

## Example

```ts
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import LiveStoreWorker from './livestore.worker?worker'

const adapter = makeAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})
```

```ts
import { makeWorker } from '@livestore/web/worker'

import { schema } from './schema/index.js'

makeWorker({ schema })
```

## Web worker

- Make sure your schema doesn't depend on any code which needs to run in the main thread (e.g. avoid importing from files using React)
  - Unfortunately this constraints you from co-locating your table definitions in component files.

### Why is there a dedicated web worker and a shared worker?

- Shared worker:
  - Needed to allow tabs to communicate with each other using a binary message channel.
  - The shared worker mostly acts as a proxy to the dedicated web worker.
- Dedicated web worker (also called "leader worker"):
  - Acts as the leader/single writer for the storage.
  - Currently needed for synchronous OPFS API. (Hopefully won't be needed in the future anymore.)

## Storage

LiveStore currently only support OPFS to locally persist its data. In the future we might add support for other storage types (e.g. IndexedDB).

LiveStore also uses `window.sessionStorage` to retain the identity of a client session (e.g. tab/window) across reloads. 