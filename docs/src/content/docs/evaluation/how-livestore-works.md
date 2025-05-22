---
title: How LiveStore works
sidebar:
  order: 1
---

### TLDR

LiveStore uses event sourcing to sync events across clients and materialize state into a local, reactive SQLite database.

![](https://share.cleanshot.com/dTpVv5K1+)

## How LiveStore Works Client-Side

On the client, LiveStore provides a reactive SQLite database for application state, which is kept consistent through an underlying event sourcing mechanism.

#### Local Reactive SQLite

Application state is materialized into a local SQLite database, offering high-performance, offline-capable data access. This SQLite database is reactive: UI components subscribe to data changes and update automatically when the state changes. LiveStore uses in-memory SQLite for sub-millisecond queries and persistent SQLite for durable storage across application sessions.

#### Event Sourcing

Underpinning the reactive state, LiveStore implements the event sourcing pattern. All data modifications are captured as an immutable, ordered sequence of events. This eventlog serves as the canonical history, enabling reliable state reconstruction and providing inherent auditability, which aids in debugging. The reactive SQLite state is a projection of this eventlog.

#### Client-Side Event Flow

1.  **Event Committing:** User interactions within the application generate events detailing the specific action (e.g., `TodoCreated`, `TaskCompleted`).
2.  **Local Persistence & Materialization:** The committed event is atomically persisted to the local eventlog and immediately materialized as state into the SQLite database.
3.  **UI Reactivity:** Changes to the SQLite database trigger the reactivity system, causing subscribed UI components (e.g. React components) to automatically update and reflect the new state.

## How LiveStore Syncing Works

LiveStore extends its local event-sourcing model globally by synchronizing events across all clients, typically through a central sync backend. This ensures that the eventlog, serving as the single source of truth, is consistently replicated, leading to an eventually consistent state for all participants.

#### Push/Pull Event Synchronization

Inspired by Git, LiveStore employs a push/pull model for event synchronization. Clients must first pull the latest events from the sync backend to ensure their local eventlog is up-to-date before they can push their own newly committed local events. This model helps maintain a global total order of events. Local pending events that haven't been pushed are rebased on top of the latest upstream events before being pushed.

#### Sync Provider Integration

LiveStore supports various sync backend implementations, and it's straightforward for developers to create their own. The sync backend is responsible for storing events, enforcing the total event order, and notifying clients of new events.

#### Conflict Resolution

When concurrent operations from different clients lead to conflicting events, LiveStore defaults to a "last-write-wins" strategy. However, it also provides the capability for developers to implement custom merge conflict resolution logic tailored to their application's specific needs.

#### Overall Syncing Data Flow

After a local event is committed and materialized (as per the client-side flow), LiveStore attempts to push this event to the sync backend. Simultaneously, LiveStore is pulling events from the sync backend in the background.

Two main scenarios can occur during a push attempt:

1.  **Client In Sync:** If the client's local eventlog is already up-to-date with the sync backend (i.e., no new remote events have arrived since the last pull/push), the local event is pushed directly.
2.  **Concurrent Incoming Events:** If new remote events have been pulled in the background, or are discovered during the push attempt, the client first processes these incoming remote events. Any local, unpushed events are then rebased on top of these new remote events before being pushed to the sync backend.

In both scenarios, once remote events are received (either through background pulling or during a push cycle), they are persisted to the local eventlog, materialized into the local SQLite database, and the UI reacts to the new state, ensuring eventual consistency.

## Platform Adapters

LiveStore includes platform adapters to integrate with various environments, such as web browsers, mobile applications (iOS/Android), desktop applications, and Node.js.