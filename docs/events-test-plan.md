# LiveStore Events Test Plan

ADD SECTION ABOUT EVERYTHING RELATED TO UNCONFIRMED WHICH WE LEAVE AS PENDING
- Anything related to rebase

### Current eventStream implementation

- minSyncLevel **client** merges client syncState which includes pending events and leader event log
- minSyncLevel **leader** emits events from event log even those not confirmed by backend
- minSyncLevel **backend** does not read from backend but reads from leader thread up until backend head

### Reflections on API

**[!]** Only placed here for temporary reference.

**[!]** These are based on my current understanding of how LiveStore works. It's possible I'm making the wrong assumptions here. To clarify my understanding I've written [this document](understanding-events.md)

**Only streaming confirmed events**

Streaming only confirmed events as discussed removes the current value of minSyncLevel client (which merges pending events) and leaves backend as the only level that guarantees confirmation which is not useful in offline scenarios.

**Dynamically pushing `until` marker to align with upstream head**

Users expect a backend-level stream to follow the advancing head without manual restarts. Today `until` is fixed at stream start at client and backend level.

**Starting stream from local head**

Starting from the local head already works via a `since` cursor, but it would probably be beneficial to document how this can be done since I can imagine it being a common scenario where users wants to take actions only on new events and not the entire event log.

**Potential issue of missed events due to rebase mid-stream when batching**
Batch 1 might read `[e41, e42]` with `since = e39` and `offset = 0`. If a rebase then replaces those rows with `[e41′, e42′]`, the next query runs with the old `offset = 2`, so it jumps straight to `[e43, …]` and never surfaces the replacements. This mirrors `syncstate.test.ts` (“should rebase single client event to end”), where upstream injects `[e1_1, e1_2, e1_3, e2_0]` ahead of a pending event; the eventlog grows, but the streaming query still only sees the tail unless the consumer rewinds to a cursor ≤ `e1_1`.

## Scenarios that can occur

- Large event log (≥100k events): confirm throughput remains stable and memory stays bounded while streaming.
- Empty log: validate the stream initializes without events and waits correctly for new data.
- High throughput log: verify ordering, batching, and backpressure when events arrive faster than they can be processed.
- Mid-stream interruption: determine resume semantics and whether behavior differs between SQL batching and SyncState sources.
- Leader rebase during stream: ensure offsets rewind or restart so replacements (`e41′`, `e42′`, etc.) surface instead of being skipped.
- Upstream head advancing: confirm the stream continues past the initial `until` and tracks the moving head.

## Property based dimensions

- Sync level: [client, leader, backend]
- Batch size: [0, 1, 16, 1000, 10000]
- Number of events: [0, 1, 16, 1000, 100000]
- Events per second: [0, 1, 16, 1000, 100000]
- Interruption at event number: [0, 1, 11]

## Deterministic scenarios

*These need to be elaborated on as to what the expected behaviour should be.*

- Rebase occurs mid-stream
- Stream progression as upstream head advances

## Use cases

**Real time event log UI**

**Analytics and monitoring**

**Event replay for testing**

**Listening to events for file syncing**

https://discord.com/channels/1154415661842452532/1426069468576223352

**Undo / redo and version history (time-travel)**

https://discord.com/channels/1154415661842452532/1419068181355434015

**High frequency event compaction**

https://discord.com/channels/1154415661842452532/1425610032481046568

## Notes from meeting with Johannes

What scenarios that could happen?
Non-trivial examples?

Very large event-log 100K events
- Zero events
- unconfirmed events
- very fast moving eventlog
- implementations considerations -> Batching? Problems due to batching? Expose batching?
- how do we deal with unconfirmed events? --> DO NOT ALLOW unconfirmed events -> confirmed by who? (leader? client?)

We want to use the filters in a way that we construct SQL queries to make the filters performant (not read all events)

What error scenarios might we encounter?

Interruptions, what happens when we interrupt? Does that continue running in the background

Consider combinatorial explosions, where are the overlaps of the edge cases

Wrap my head around the hard stuff. Then see what we can make less hard.

Look at property based testing:
- tests/integration/src/tests/node-sync/node-sync.test.ts