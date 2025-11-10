# Web Email Client Example

A email client demonstrating LiveStore's multi-store architecture with cross-store synchronization.

## Architecture Overview

This example implements a simplified email interface with two stores:

- **Inbox (singleton)**: Manages labels, thread index, and global UI state
- **Thread (multi-instance)**: One instance per thread, owns thread and label associations

### Architecture Diagram

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

## Cross-Store Synchronization

[//]: # (TODO: Explain that in LiveStore, each store is isolated. Events can only be committed to a single store (to the store's event log) and materialized within that same store's state DB. If we need to update state in another store, we have to handle this outside of LiveStore. In this example, we use event publishing pattern with Cloudflare Queues for that. Explain the challenges with this solution (e.g. same event duplication). List the multiple flows we implemented (and why we needed to implement them).

### Consistency Boundaries
- **Inbox**: Owns labels, thread index, UI state. Read-only for thread data.
- **Thread**: Owns threads, messages, and label associations.

## Project Structure

```
src/
├── cf-worker/
│   ├── InboxClientDO.ts      # Singleton Durable Object for Inbox
│   ├── ThreadClientDO.ts     # Per-thread Durable Object
│   ├── worker.ts             # Request handler + queue consumer
│   └── shared.ts             # Env types, CrossStoreEvent definitions
├── stores/
│   ├── inbox/
│   │   ├── schema.ts         # Inbox events, tables, materializers
│   │   └── seed.ts           # Initial system labels
│   └── thread/
│       ├── schema.ts         # Thread events, tables, materializers
│       ├── seed.ts           # Sample thread data
│       └── index.ts          # Store factory
└── components/
    └── [React components]
```

## Running Locally

```bash
# Install dependencies
pnpm install

# Start Cloudflare and Vite dev server
pnpm dev

# Open browser
open http://localhost:8787
```

## Technologies

- **LiveStore**: Event-sourced state management with SQLite
- **Cloudflare Workers**: Serverless compute runtime
- **Cloudflare Durable Objects**: Stateful serverless instances
- **Cloudflare Queues**: Pub/sub messaging for cross-store events
- **React**: UI framework
- **Vite**: Frontend build tool
