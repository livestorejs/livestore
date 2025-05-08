---
title: Store
sidebar:
  order: 3
---

The `Store` is the most common way to interact with LiveStore from your application code. It provides a way to query data, commit events, and subscribe to data changes.

## Creating a store

For how to create a store in React, see the [React integration docs](/docs/reference/framework-integrations/react-integration). The following example shows how to create a store manually:

```ts
import { createStorePromise } from '@livestore/livestore'
import { schema } from './livestore/schema.js'

const adapter = // ...

const store = await createStorePromise({
  schema,
  adapter,
  storeId: 'some-store-id',
})
```

## Using a store

### Querying data

```ts
const todos = store.query(tables.todos)
```

### Subscribing to data

```ts
const unsubscribe = store.subscribe(tables.todos, (todos) => {
  console.log(todos)
})
```

### Committing events

```ts
store.commit(events.todoCreated({ id: '1', text: 'Buy milk' }))
```

### Shutting down a store

```ts
await store.shutdown()
```

## Multiple Stores

You can create and use multiple stores in the same app. This can be useful when breaking up your data model into smaller pieces.

## Development/debugging helpers

A store instance also exposes a `_dev` property that contains some helpful methods for development. For convenience you can access a store on `globalThis`/`window` like via `__debugLiveStore.default._dev` (`default` is the store id):

```ts
// Download the SQLite database
__debugLiveStore.default._dev.downloadDb()

// Download the eventlog database
__debugLiveStore.default._dev.downloadEventlogDb()

// Reset the store
__debugLiveStore.default._dev.hardReset()

// See the current sync state
__debugLiveStore.default._dev.syncStates()
```   
