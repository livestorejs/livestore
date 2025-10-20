# LiveStore Events Test Plan

## Scenarios that can occur

**Very large event log**

What happens when we have 100K+ events being streamed?

**Zero events in event log**

Does the stream start if there are no events to begin with?
Does the stream end or wait for events to arrive to push through?

**Very fast moving event log**

Can issues occur related to memory or even event ordering?

**Interruption mid-stream**

When a stream get's interrupted what happens to underlying process?
Would this differ from SQL batching and SyncState sources?
What could cause an interruption?

**Leader thread rebase mid-stream**

Batch 1 might read `[e41, e42]` with `since = e39` and `offset = 0`. If a rebase then replaces those rows with `[e41′, e42′]`, the next query runs with the old `offset = 2`, so it jumps straight to `[e43, …]` and never surfaces the replacements. This is the same shape as the `syncstate.test.ts` case (“should rebase single client event to end”), where upstream injects `[e1_1, e1_2, e1_3, e2_0]` ahead of a pending event; the eventlog grows, but the streaming query only sees the tail unless restarted from a cursor ≤ `e1_1`.

**Upstream head advances mid-stream**

Should the stream update to the new location or maintain initial value?

**Since or until event gets deleted mid-stream due to rebase**
If an event referenced as the since marker gets deleted due to a rebase would the stream continue?
If the until event disappears does the stream go on forever? Would the next SQL query fail?

## Property based testing

- Sync level: [client, leader, backend]
- Batch size: [0, 1, 16, 1000, 10000]
- Number of events: [0, 1, 16, 1000, 100000]
- Events per second: [0, 1, 16, 1000, 100000]
- Interruption at event number: [0, 1, 11]
- Rebase scenarios: [?]

## Notes

### Current implementation of eventStream
minSyncLevel client merges client syncState which includes pending events and leader event log
minSyncLevel leader emits all events even those not confirmed by backend
minSyncLevel backend does not read from backend but reads from leader thread up until backend head

###

## Questions

How do we deal with events that get rebased?

When the eventStream with minSyncLevel backend is started it picks the until point as the current upstreamHead, as that head advances the stream would not go past that point but wouldn't the expected scenario be that the stream continues to progress as the heead advances?

Would it make sense to use the event metadata

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

After these scenarios what would then be the test-plan and the design of the tests

Consider combinatirial explosions, where are the overlaps of the edge scenarios

Wrap my head around the hard stuff. Then see what we can make less hard.

Look at property based testing:
- tests/integration/src/tests/node-sync/node-sync.test.ts

Create a test plan in prose.