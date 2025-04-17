---
title: Web Adapter
description: Information about LiveStore's web adapter
sidebar:
  order: 1
---

## Example

```ts
import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import LiveStoreWorker from './livestore.worker?worker'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})
```

```ts
import { makeWorker } from '@livestore/adapter-web/worker'

import { schema } from './schema/index.js'

makeWorker({ schema })
```

## Web worker

- Make sure your schema doesn't depend on any code which needs to run in the main thread (e.g. avoid importing from files using React)
  - Unfortunately this constraints you from co-locating your table definitions in component files.
  - You might be able to still work around this by using the following import in your worker:
    ```ts
    import '@livestore/adapter-web/worker-vite-dev-polyfill'
    ```

### Why is there a dedicated web worker and a shared worker?

- Shared worker:
  - Needed to allow tabs to communicate with each other using a binary message channel.
  - The shared worker mostly acts as a proxy to the dedicated web worker.
- Dedicated web worker (also called "leader worker" via leader election mechanism using web locks):
  - Acts as the leader/single writer for the storage.
  - Also handles connection to sync backend.
  - Currently needed for synchronous OPFS API which isn't supported in a shared worker. (Hopefully won't be needed in the future anymore.)

### Why not use a service worker?

- While service workers seem similar to shared workers (i.e. only a single instance across all tabs), they serve different purposes and have different trade-offs.
- Service workers are meant to be used to intercept network requests and tend to "shut down" when there are no requests for some period of time making them unsuitable for our use case.
- Also note that service workers don't support some needed APIs such as OPFS.

## Storage

LiveStore currently only support OPFS to locally persist its data. In the future we might add support for other storage types (e.g. IndexedDB).

LiveStore also uses `window.sessionStorage` to retain the identity of a client session (e.g. tab/window) across reloads. 

## Other notes

- The web adapter is using some browser APIs that might require a HTTPS connection (e.g. `navigator.locks`). It's recommended to even use HTTPS during local development (e.g. via [Caddy](https://caddyserver.com/docs/automatic-https)).

## Browser support

- Notable required browser APIs: OPFS, SharedWorker, `navigator.locks`, WASM
- The web adapter of LiveStore currently doesn't work on Android browsers as they don't support the `SharedWorker` API (see [Chromium bug](https://issues.chromium.org/issues/40290702)).

## Best Practices

- It's recommended to develop in an incognito window to avoid issues with persistent storage (e.g. OPFS).

## FAQ

### What's the bundle size of the web adapter?

LiveStore with the web adapter adds two parts to your application bundle:

- The LiveStore JavaScript bundle (~180KB gzipped)
- SQLite WASM (~300KB gzipped)
