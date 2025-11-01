# LiveStore Events Test Plan

## NOTES

Where can we document the design decisions on the event stream api?
- JSDoc
- Write it one reference in others
- Any other natural default?
[!] How does this thing work? Why were certain decisions taken
    - For example why we placed the logic in the leader worker

Test from both store and leader thread perspective
Store -> More integration type tests
Leader thread -> Closer to unit-test style

Add note on why Queue's are used in tests -> To allow checking the stream in stages


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

- [x] Stream progresses as upstream head advances
- [x] Events get filtered by name
- [x] Events streamed until specific upstream head includes it then finalizes
- [x] Events streamed since local head doesn't include local head
- [x] Events get filtered by client ID
- [x] Events get filtered by session ID

## Integration tests

- [ ] Stream resumes when reconnected to sync backend

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