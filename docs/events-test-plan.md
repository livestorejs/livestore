# LiveStore Events Test Plan

## NOTES

## Event decoding

Currently hanled in store, option to move decoming to leader thread. Should we consider decoding on the leader-thread?

**Decode in store (current appraoch)**
- Keeps leader-thread stream schema-agnostic
- Decode errors surface in store
- Potential UI lag for high throughput

**Decode in leader-thread**
- Requires passing event schema to leader-thread
- Tightens coupling, every adapter must memoize and thread the event schema
- More resilience to UI lag in high throughput scnearios since decode is handled on separeate thread

## Performance tests

We need to decide what the most suitable location for testing high throughput event streaming scenarios.
- Sequentially creating 100K+ events not suitable for local test runtime
- Generating and saving db snapshot with large event-count as alternative approach. Example: tests/perf/scripts/generate-eventlog-snapshot.ts
- Ideally we want to test high throughput concurrent streams which is probably best suitable in a `perf` test-like setup.

**Possible approaches**

**Unit style test in `stream-events.test.ts`**
- Requires db-snapshot or batch event-creation utility

**Node based perfomance test script `stream-events-benchmark.ts` (implemented)**
- Requires db-snapshot or batch event-creation utility
- When would this run?

**Playwright test using web adapter like existing `perf` tests**
- Extend `perf` test-app to stream events?
    - Possibility of conditionally loading component that does event-streaming to avoid affecting existing perf tests
- Create new `perf-streaming` folder focused on `event-streaming`?
    - Easier to isolate event streaming utilities
    - More files to maintain

## OTEL

**Current gaps**
- Streams in worker adapters already run within top level otel span
- `streamEventsWithSyncState`: Missing span metadata for things like head advances, batch counts and filters
- `streamEventsFromEventLog`: Current Stream.unfold offers no spans around expensive query work.
- Store to leader traces don't propagate a shared OTEL context so any segments fetched in leader thread appear disconnected relative to Store.eventStream

**Suggestions**
- `streamEventsWithSyncState`: Wrap each event stream segment in an otel span with relevant meta data
- `streamEventsFromEventLog`: Switch `Stream.unfold` to `Strem.unfoldEffect` and convert database calls in an `Effect` and wrap with span with current query attrs.


## Important notice for first version of event streaming api

Unconfirmed events are excluded in the first version of the event streaming API. The practical implication of this is that we only allow streaming events confimed by the sync backend. Including unconfirmed events would need to pay careful attention to a shifting event log due to rebasing particularly when considered in combination with batch SQL queries.

## Scenarios that can occur

- Large event log (>100k events): confirm throughput remains stable and memory stays bounded while streaming.
- Empty log: validate the stream initializes without events and waits correctly for new data.
- High throughput log: verify ordering, batching, and backpressure when events arrive faster than they can be processed.
- Mid-stream interruption: determine resume semantics and whether behavior differs between SQL batching and SyncState sources.
- Upstream head advancing: confirm the stream continues past the initial `until` and tracks the moving head.


## Deterministic scenarios

- [x] Stream progresses as upstream head advances
- [x] Events get filtered by name
- [x] Events streamed until specific upstream head includes it then finalizes
- [x] Events streamed since local head doesn't include local head
- [x] Events get filtered by client ID
- [x] Events get filtered by session ID
- [x] Client only events get filtered out

## Property based dimensions

- Batch size: [1, 5, 12, 25, 50, 100]
- Number of events: [0, 1, 6, 10, 100]
- Batch size per tick: [1, 3, 10, 100]

## Integration tests

- [x] Stream resumes when reconnected to sync backend

## Performance test

- [ ] Large event log >100K

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