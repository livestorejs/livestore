# Notes on LiveStore event system

**Client session**
- SQLite database that matches the schema
- SyncState in-memory for pending events only

**Leader thread**
- SQLite dbState - mirrors schema so leader can materialize events and handle rollbacks
- SQLite dbEventLog - stores the durable event log and tracks global sequence of events which the backend has acknowledged

**Sync backend**
- Any storage solution that supports pushing and pulling events. Events are never deleted only appended.

## What happens when you commit an event

1. Client commits an event
    - Merges event into local SyncState with state pending
    - Pushes event to leader thread

2. Leader thread persists the event
    - Materializes event
    - Writes row to EventLog table

3. Leader thread emits signal back to subscribed clients
    - On receipt client merges new event into SyncState
    - Event in client goes from pending to confirmed
    - Client syncState and leader head now at same location

4. Leader thread pushes event to backend
    - Event still marked as pending in leader thread

6. Backend pulls event from leader thread
    - Notifies leader thread of receipt
    - Leader thread marks event as confirmed
    - Backend head advances
    - Event confirmed on all levels and heads at same location

## What happens when a conflict is detected and rebase occurs?

1. Leader thread detects incoming events that conflict with the clients pending chain
    - Local events are compared to upstream events to find point of divergence

2. Client rolls back changes until divergence point
    - Each event has a SQLite changeset which is used to revert the applied changes in reverse order
    - Database state is now restored to point where events diverged

3. Client applies upstream canonical events
    - Previous events in syncstate are replaced by new events
    - Original pending events are stored so their changesets can be cleaned up (rollbackEvents)

4. Client replays its own pending events on top of new head
    - Stored original events (rollbackEvents) keep their original payload but their sequence number gets updated to follow upstream head
    - Each newly numbered event is re-appplied (materialized) to store database

5. Leader and backend stay in sync
    - Leader applies same rollback/replay cycle if the backend event forces the rebase first
    - After replay both leader head and client syncstate head are aligned

### What happens to an event during rebase?

1. Before conflict
    - Client pending list: e42 (rename todo)
    - Leader `eventlog`: … e41, e42
    - Backend has not seen e42 yet

2. Upstream sends a rebase (Step 1)
    - Leader receives canonical history that replaces e42 with a different event

3. Rollback (Step 2)
    - Leader runs `rollback` and deletes the old e42 row from `eventlog`
    - Client `SyncState.pending` drops e42 while its changeset is inverted

4. Apply upstream events (Step 3)
    - Leader inserts the canonical e42 from upstream
    - Client applies the same canonical e42

5. Replay local work (Step 4)
    - Client rename event is re-enqueued as e43 and materialized
    - Client `SyncState.pending` now holds e43; leader `eventlog` shows … e41, e42 (canonical), e43

Result: the original e42 is gone; the sequence jumps from the upstream e42 straight to the rebased local e43.

A gap in the leader event log (e1, e3) is never possible unless an upstream rebase deletes a row and never replaces it. Because the backend is sync only this should never happen.
