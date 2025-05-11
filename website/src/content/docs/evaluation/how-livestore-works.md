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

1.  A local event is committed, persisted, materialized, and triggers UI updates as per the client-side flow.
2.  The client pulls the latest events from the sync backend and rebases any local, unpushed events.
3.  The (rebased) local event is then asynchronously pushed to the sync provider.
4.  The sync provider relays the event to other connected clients.
5.  Receiving clients pull this event, persist it to their local eventlog, materialize the change into their SQLite database, and their UIs react to the new state.

This cycle ensures that all clients eventually converge to a consistent application state.

## Platform Adapters

LiveStore includes platform adapters to integrate with various environments, such as web browsers, mobile applications (iOS/Android), desktop applications, and Node.js.