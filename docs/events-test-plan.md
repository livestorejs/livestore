# LiveStore Events Test Plan

## Important notice for first version of event streaming api

We have decided to exclude all unconfirmed events in the first version of the event streaming API. The practical implication of this is that we only allow streaming events confimed by the sync backend Including unconfirmed events would need to pay careful attention to a shifting event log due to rebasing mid-stream and comes with implications affecting both implementation and usage of the api.

### Issues to consider

**Only streaming confirmed events**

Streaming only confirmed events as discussed removes the current value of minSyncLevel client (which merges pending events) and leaves backend as the only level that guarantees confirmation which is not useful in offline scenarios.

**Dynamically pushing `until` marker to align with upstream head**

Users expect a backend-level stream to follow the advancing head without manual restarts. Today `until` is fixed at stream start.

**Starting stream from local head**

Starting from the local head already works via a `since` cursor, but it would probably be beneficial to document how this can be done since I can imagine it being a common scenario where users wants to take actions only on new events and not the entire event log.

## Scenarios that can occur

- Large event log (≥100k events): confirm throughput remains stable and memory stays bounded while streaming.
- Empty log: validate the stream initializes without events and waits correctly for new data.
- High throughput log: verify ordering, batching, and backpressure when events arrive faster than they can be processed.
- Mid-stream interruption: determine resume semantics and whether behavior differs between SQL batching and SyncState sources.
- Upstream head advancing: confirm the stream continues past the initial `until` and tracks the moving head.

## Property based dimensions

NOTE:
Convert into dynamic ranges for a more "fuzzing" like approach:
tests/integration/src/tests/node-sync/node-sync.test.ts

- Batch size: [0, 1-20, 1000-10000]
- Number of events: [0, 1-20, 1000-100000]
- Events per second: [0, 1-20, 1000-100000]

## Deterministic scenarios

- Interruption mid-stream
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