# LiveStore Events Test Plan

## Important notice for first version of event streaming api

Unconfirmed events are excluded in the first version of the event streaming API. The practical implication of this is that we only allow streaming events confimed by the sync backend. Including unconfirmed events would need to pay careful attention to a shifting event log due to rebasing particularly when considered in combination with batch SQL queries.

## Scenarios that can occur

- Large event log (≥100k events): confirm throughput remains stable and memory stays bounded while streaming.
- Empty log: validate the stream initializes without events and waits correctly for new data.
- High throughput log: verify ordering, batching, and backpressure when events arrive faster than they can be processed.
- Mid-stream interruption: determine resume semantics and whether behavior differs between SQL batching and SyncState sources.
- Upstream head advancing: confirm the stream continues past the initial `until` and tracks the moving head.

## Property based dimensions

NOTE:
Convert into dynamic ranges for a more "fuzzing" like approach:
Reference: tests/integration/src/tests/node-sync/node-sync.test.ts

- Batch size: [0, 1-20, 1000-10000]
- Number of events: [0, 1-20, 1000-100000]
- Events per second: [0, 1-20, 1000-100000]

## Deterministic scenarios

- Stream progresses as upstream head advances
- Only confirmed events are included in the stream
- Stream stops when backend connection is lost and resumes when reconnected
- Events streamed since local head doesn't include local head
- Events streamed until specific upstream head includes it then finalizes
- Events get filtered by name
- Events get filtered by client ID
- Events get filtered by session ID

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