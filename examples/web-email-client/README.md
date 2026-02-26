# Web Email Client Example

An email client using multi-store architecture to demonstrate partial sync, cross-store sync, and command replay.

## Partial Synchronization

We can only load so much data in the browser before hitting memory limits and making the initial load unbearably slow. A typical email mailbox with hundreds of thousands of threads would exceed this limit.

To solve this, we can partition the application data into multiple independent stores that can be lazy-loaded on demand.

### How to Partition the Data?

A helpful approach is to think about our data model's consistency boundaries. What are the smallest units of data that must remain consistent within themselves? A common pattern in email clients is that each email thread is mostly self-contained. Threads have few dependencies on other parts of the data model. Thus, we can partition threads into their own stores with minimal impact on the rest of the application state.

This approach allows loading only the threads that the user is actively viewing or interacting with, reducing the amount of data held in memory at any given time. The rest of the data lives in a single, always-loaded Mailbox store. In a real application, the Mailbox store could be further partitioned into additional stores (e.g., Contacts store) to allow for even more granular data loading.

### Stores

**Mailbox Store**

- Singleton
- Manages labels, thread index, and UI state
- Lifecycle: Loaded on startup, always in memory

**Thread Store**:

- One per email thread
- Manages a single thread's messages and label associations
- Lifecycle: Loaded on-demand, garbage collected when inactive
- Commands: `ApplyLabel`, `RemoveLabel`, `ReplaceLabel`

## Commands and Conflict Handling

The Thread store uses [commands](../../contributor-docs/rfcs/0002-command-replay.md) (`defineCommand` + `store.execute()`) instead of committing events directly. Commands encode domain invariants and are replayed during sync reconciliation.

### Thread Label Commands

- **`ApplyLabel`**: Applies a label to a thread. Returns `LabelAlreadyApplied` if the label is already present, preventing duplicate rows.
- **`RemoveLabel`**: Removes a label from a thread. Returns `LabelNotOnThread` if the label isn't present, preventing a no-op event from being committed.
- **`ReplaceLabel`**: Atomically swaps one label for another by removing the current label and applying the target. Used for system label transitions (e.g., moving a thread from INBOX to ARCHIVE). This enforces the invariant that a thread always has exactly one system label.

### Why Commands?

When events arrive from other clients during sync, LiveStore replays commands against the updated state. A command handler may then:

- **Produce the same events**: The local change is compatible — no conflict.
- **Produce different events**: The local change adapts to the new state (e.g., the current label changed, so the remove targets a different label).
- **Return an error**: The local change conflicts with the new state — the command's events are rolled back.

For example, if two clients both try to archive a thread at the same time, the second client's `ReplaceLabel` command will replay against state where the thread is already archived. The handler finds that `currentLabelId` (INBOX) is no longer on the thread, returns `LabelNotOnThread`, and rolls back.

### Conflict UI

When `ReplaceLabel` returns a conflict, `ThreadActions` shows a banner letting the user retry the operation or dismiss it, rather than silently losing the action.

## Cross-Store Synchronization

In LiveStore, **each store is completely isolated**:

- **Event Log**: Events can only be committed to a single store's append-only event log
- **State DB**: Events are materialized into that same store's database via materializers
- **Consistency Boundary**: Consistency is guaranteed only within a single store
- **No Built-in Cross-Store Communication**: Stores cannot directly reference or modify other stores

In our email client, we partition threads into their own stores. However, this creates challenges. We need a way to query the list of threads, but thread data now lives in separate Thread stores. We can't load all thread stores at once as that would defeat the purpose of partitioning. We then need to maintain an index of threads in the Mailbox store. But how do we keep that index updated when changes happen in individual Thread stores?

Additionally, we need to update some data in the Mailbox store that reflects changes made in individual Thread stores. For example, when a label is applied to a thread, the Mailbox store needs to update its count of threads for that label so that we can display an accurate thread count without loading all Thread stores.

To solve these issues, we maintain **projection tables** in the Mailbox store that mirror Thread data:

- `threadIndex`: Thread metadata for listing/searching
- `threadLabels`: Thread-label associations for filtering
- `labels.threadCount`: Cached counts per label

These projections are **eventually consistent** copies that we synchronize via cross-store events. This is implemented using an event publishing pattern:

1. **Change Detection**: ThreadClientDO subscribes to its store's tables and detects changes by comparing current snapshots against previous state
2. **Event Publishing**: When changes are detected, ThreadClientDO publishes cross-store events to the `cross-store-events` Cloudflare Queue
3. **Event Consumption**: The Queue Consumer Worker processes events from the queue
4. **State Update**: The worker calls MailboxClientDO methods, which commit events to the Mailbox store
5. **Materialization**: Mailbox materializers update projection tables

> [!NOTE]
> This currently needs to be implemented manually as LiveStore doesn't yet provide primitives for cross-store communication.

## Known Limitations

- **`useQuery` doesn't support Suspense** ([#822](https://github.com/livestorejs/livestore/issues/822)): `useStore()` suspends while the store initializes, but `useQuery()` does not suspend while waiting for sync data to arrive. This means there's a brief window after the store resolves where queries can return empty results. Components that depend on synced data need manual null checks as a workaround until suspense-compatible query hooks are available. This is particularly noticeable in the cross-store architecture: clicking a thread creates its Thread store on-demand, and the store resolves before the sync backend has delivered the thread data seeded by `ThreadClientDO`. The `ThreadView` component works around this with a null guard that shows a loading state until the data arrives.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                 BROWSER                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────────┐            ┌───────────────────────────┐  │
│  │  Mailbox Store            │            │  Thread Store             │  │
│  │  (Singleton)              │            │  (Multi-Instance)         │  │
│  │                           │            │                           │  │
│  │  ID: mailbox-root         │            │  ID: thread-{id}          │  │
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
│  │  • v1.ThreadLabelRemoved  │            │  Commands:                │  │
│  │  • v1.UiStateSet          │            │  • ApplyLabel             │  │
│  │                           │            │  • RemoveLabel            │  │
│  │                           │            │  • ReplaceLabel           │  │
│  └─────────────┬─────────────┘            └─────────────┬─────────────┘  │
│                │                                        │                │
│                │ Sync                                   │ Sync           │
│                │                                        │                │
└────────────────┼────────────────────────────────────────┼────────────────┘
                 │                                        │
                 │ WebSocket                              │ WebSocket
                 │                                        │
┌────────────────┼────────────────────────────────────────┼────────────────┐
│                │               CLOUDFLARE               │                │
├────────────────┼────────────────────────────────────────┼────────────────┤
│                │                                        │                │
│                │        ┌──────────────────────┐        │                │
│                │        │   SyncBackendDO      │        │                │
│                └───────▶│                      │◀───────┘                │
│                ┌───────▶│  Handles event sync  │◀───────┐                │
│                │        │  for all stores      │        │                │
│                │        └──────────────────────┘        │                │
│                │                                        │                │
│                │ Sync                                   │ Sync           │
│                │                                        │                │
│  ┌─────────────┴────────────┐     ┌─────────────────────┴─────────────┐  │
│  │  MailboxClientDO         │     │  ThreadClientDO                   │  │
│  │  (Singleton)             │     │  (Multi-Instance)                 │  │
│  │                          │     │                                   │  │
│  │  Holds: a Mailbox store  │     │  Holds: a Thread store            │  │
│  │                          │     │                                   │  │
│  │  Methods:                │     │  Methods:                         │  │
│  │  • initialize()          │     │  • initialize()                   │  │
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
│  │  Worker                   │◀──────│  cross-store-events  │            │
│  │  (Queue Consumer)         │       │  (Cloudflare Queue)  │            │
│  │                           │       └──────────────────────┘            │
│  │  Processes events:        │                                           │
│  │  • v1.ThreadCreated       │                                           │
│  │  • v1.ThreadLabelApplied  │                                           │
|  │  • v1.ThreadLabelRemoved  │                                           │
│  │                           │                                           │
│  │  Calls MailboxClientDO:   │                                           │
│  │  • addThread()            │                                           │
│  │  • applyThreadLabel()     │                                           │
│  │  • removeThreadLabel()    │                                           │
│  └───────────────────────────┘                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```
