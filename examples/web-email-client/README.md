# Web Email Client Example

An email client using multi-store architecture to demonstrate partial sync and cross-store sync.

## Partial Synchronization

We can only load so much data in the browser before hitting memory limits and making the initial load unbearably slow. A typical email mailbox with thousands of threads would exceed this limit.

To solve this, we can partition the application data into multiple independent stores that can be lazy-loaded on demand:

**Inbox Store**
- Singleton
- Manages labels, thread index, and UI state
- Lifecycle: Loaded on startup, always in memory

**Thread Store**:
- One per email thread
- Manages a single thread's messages and label associations
- Lifecycle: Loaded on-demand, garbage collected when inactive

## Cross-Store Synchronization

In LiveStore, **each store is completely isolated**:

- **Event Log**: Events can only be committed to a single store's append-only event log
- **State DB**: Events are materialized into that same store's database via materializers
- **Consistency Boundary**: Consistency is guaranteed only within a single store
- **No Built-in Cross-Store Communication**: Stores cannot directly reference or modify other stores

However, in our email client, we need to maintain some data in the Inbox store that reflects changes made in individual Thread stores. For example, when a new thread is created or a label is applied to a thread, the Inbox store needs to update its thread index and label associations accordingly.

To achieve this, we use the following strategy:

Maintain **projection tables** in the Inbox store that mirror Thread data:
- `threadIndex`: Thread metadata for listing/searching
- `threadLabels`: Thread-label associations for filtering
- `labels.threadCount`: Cached counts per label

These projections are **eventually consistent** copies synchronized via cross-store events.

Since LiveStore doesn't provide cross-store communication, we implement it using an event publishing pattern:

1. **Change Detection**: ThreadClientDO subscribes to its store's tables and detects changes by comparing current snapshots against previous state
2. **Event Publishing**: When changes are detected, ThreadClientDO publishes cross-store events to the `cross-store-events` Cloudflare Queue
3. **Event Consumption**: The Queue Consumer Worker processes events from the queue
4. **State Update**: The worker calls InboxClientDO methods, which commit events to the Inbox store
5. **Materialization**: Inbox materializers update projection tables

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Frontend)                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────────┐            ┌───────────────────────────┐  │
│  │  Inbox Store              │            │  Thread Store             │  │
│  │  (Singleton)              │            │  (Multi-Instance)         │  │
│  │                           │            │                           │  │
│  │  ID: inbox-root           │            │  ID: thread-{id}          │  │
│  │                           │            │                           │  │
│  │  Tables:                  │            │  Tables:                  │  │
│  │  • labels                 │            │  • thread                 │  │
│  │  • threadIndex            │            │  • messages               │  │
│  │  • threadLabels           │            │  • threadLabels           │  │
│  │  • uiState                │            │                           │  │
│  │                           │            │  Events:                  │  │
│  │  Events:                  │            │  • v1.ThreadCreated       │  │
│  │  • v1.LabelCreated        │            │  • v1.MessageAdded        │  │
│  │  • v1.ThreadAdded         │            │  • v1.ThreadLabelApplied  │  │
│  │  • v1.ThreadLabelApplied  │            │  • v1.ThreadLabelRemoved  │  │
│  │  • v1.ThreadLabelRemoved  │            │                           │  │
│  │  • v1.UiStateSet          │            │                           │  │
│  └─────────────┬─────────────┘            └─────────────┬─────────────┘  │
│                │                                        │                │
│                │ Sync                                   │ Sync           │
│                │                                        │                │
└────────────────┼────────────────────────────────────────┼────────────────┘
                 │                                        │
                 │ WebSocket                              │ WebSocket
                 │                                        │
┌────────────────┼────────────────────────────────────────┼────────────────┐
│                │          CLOUDFLARE (Backend)          │                │
├────────────────┼────────────────────────────────────────┼────────────────┤
│                │                                        │                │
│                │        ┌──────────────────────┐        │                │
│                │        │  SyncBackendDO       │        │                │
│                └───────▶│  (Sync Coordinator)  │◀───────┘                │
│                         │                      │                         │
│                ┌───────▶│  Handles event sync  │◀───────┐                │
│                │        │  for all stores      │        │                │
│                │        └──────────────────────┘        │                │
│                │                                        │                │
│                │ Sync                                   │ Sync           │
│                │                                        │                │
│  ┌─────────────┴────────────┐     ┌─────────────────────┴─────────────┐  |
│  │  InboxClientDO           │     │  ThreadClientDO                   │  │
│  │  (Singleton)             │     │  (Multi-Instance)                 │  │
│  │                          │     │                                   │  │
│  │  Holds: a Inbox store    │     │  Holds: a Thread store            │  │
│  │                          │     │                                   │  │
│  │  Methods:                │     │  Methods:                         │  │
│  │  • initialize(           │     │  • initialize(                    │  │
│  │  • addThread()           │     │                                   │  │
│  │  • applyThreadLabel()    │     │  Publishes (Cross-Store Events):  │  │
│  │  • removeThreadLabel()   │     │  • v1.ThreadCreated               │  │
│  │                          │     │  • v1.ThreadLabelApplied          │  │
│  │                          │     │  • v1.ThreadLabelRemoved          │  │
│  │                          │     │                 │                 │  │
│  └──────────────────────────┘     └─────────────────┼─────────────────┘  │
│         ▲                                           │ Publish            │
|         │ Call                                      ▼                    │
│  ┌──────┴────────────────────┐       ┌──────────────────────┐            │
│  │  Queue Consumer           │◀──────│  cross-store-events  │            │
│  │  (Worker)                 │       │  (Cloudflare Queue)  │            │
│  │                           │       └──────────────────────┘            │
│  │  Processes events:        │                                           │
│  │  • v1.ThreadCreated       │                                           │
│  │  • v1.ThreadLabelApplied  │                                           │
|  │  • v1.ThreadLabelRemoved  │                                           │
│  │                           │                                           │
│  │  Calls InboxClientDO:     │                                           │
│  │  • addThread()            │                                           │
│  │  • applyThreadLabel()     │                                           │
│  │  • removeThreadLabel()    │                                           │
│  └───────────────────────────┘                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```
