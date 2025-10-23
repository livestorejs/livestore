# Notes from meeting with Johannes
add node diagrams for visual tracking of state
client -> client Session
SQLite not tighlty coupled in future -> SQLite -> Materialized State
Lead with events -> State follows events
Write document primariy from en event perspective (state as a bonus / secondary effect)
Free people from thinking about both events and state
new events -> pulled events
important conepts to understand (push, pull)
client session can pull down rebase results from the leader (same as the leader pulls event from the sync backend)
cannonical -> authoratative
Experiment with visual and notation style for events
important to understand heads
client, leader and backedn -> Nodes
Each node has a head
https://www.tldraw.com/f/aR50x7vdQmBUGx4k7WIEf?d=v-601.-130.2908.1572.BfMH9wpQWHX7Ss2oP9TbE


Two scenarios:
rebase on leader (app comes back from offline -> all session in leader all in sync)
multiple sessions (tabs) a lot of stuff is happening concurrently -> each session is trying to win which is the next event


# Notes on LiveStore event system

**Client session**
- SQLite database that matches the schema
- SyncState in-memory for pending events only

**Client leader thread**
- SQLite dbState - mirrors schema so leader can materialize events and handle rollbacks
- SQLite dbEventLog - stores the durable event log and tracks global sequence of events which the backend has acknowledged

**Sync backend**
- Any storage solution that supports pushing and pulling events. Events are never deleted only appended.

## What happens when you commit an event (happy path)

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

This can happen in on client and leader level

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
    - Client `SyncState.pending` drops e42

4. Apply upstream events (Step 3)
    - Leader inserts the canonical e42 from upstream
    - Client applies the same canonical e42

5. Replay local work (Step 4)
    - Client rename event is re-enqueued as e43 and materialized
    - Client `SyncState.pending` now holds e43; leader `eventlog` shows … e41, e42 (canonical), e43

Result: the original e42 is gone; the sequence jumps from the upstream e42 straight to the rebased local e43.

A gap in the leader event log (e1, e3) is never possible unless an upstream rebase deletes a row and never replaces it. Because the backend is sync only this should never happen.
