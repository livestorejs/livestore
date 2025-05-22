---
title: 'Build your own sync provider'
sidebar:
  order: 20
---

It's very straightforward to implement your own sync provider. A sync provider implementation needs to do the following:

## Client-side

Implement the `SyncBackend` interface (running in the client) which describes the protocol for syncing events between the client and the server.

```ts
// Slightly simplified API (see packages/@livestore/common/src/sync/sync.ts for the full API)
export type SyncBackend = {
  pull: (cursor: EventSequenceNumber) => Stream<{ batch: LiveStoreEvent[] }, InvalidPullError>
  push: (batch: LiveStoreEvent[]) => Effect<void, InvalidPushError>
}

// my-sync-backend.ts
const makeMySyncBackend = (args: { /* ... */ }) => {
  return {
    pull: (cursor) => {
      // ...
    },
    push: (batch) => {
      // ...
    }
  }
}

// my-app.ts
const adapter = makeAdapter({
  sync: {
    backend: makeMySyncBackend({ /* ... */ })
  }
})
```

The actual implementation of those methods is left to the developer and mostly depends on the network protocol used to communicate between the client and the server.

Ideally this implementation considers the following:

- Network connectivity (offline, unstable connection, etc.)
- Ordering of events in case of out-of-order delivery
- Backoff and retry logic

## Server-side

Implement the actual sync backend protocol (running in the server). At minimum this sync backend needs to do the following:

  - For client `push` requests:
    - Validate the batch of events
      - Ensure the batch sequence numbers are in ascending order and larger than the sync backend head
      - Further validation checks (e.g. schema-aware payload validation)
    - Persist the events in the event store (implying a new sync backend head equal to the sequence number of the pushed last event)
    - Return a success response
    - It's important that the server only processes one push request at a time to ensure a total ordering of events.

  - For client `pull` requests:
    - Validate the cursor
    - Query the events from the database
    - Return the events to the client
    - This can be done in a batch or streamed to the client
    - `pull` requests can be handled in parallel by the server

## General recommendations

It's recommended to study the existing sync backend implementations for inspiration.
