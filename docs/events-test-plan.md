# LiveStore Events Test Plan

## Important notice for first version of event streaming api

Unconfirmed events are excluded in the first version of the event streaming API. The practical implication of this is that we only allow streaming events confimed by the sync backend. Including unconfirmed events would need to pay careful attention to a shifting event log due to rebasing particularly when considered in combination with batch SQL queries.

## Scenarios that can occur

- Large event log (>100k events): confirm throughput remains stable and memory stays bounded while streaming.
- Empty log: validate the stream initializes without events and waits correctly for new data.
- High throughput log: verify ordering, batching, and backpressure when events arrive faster than they can be processed.
- Mid-stream interruption: determine resume semantics and whether behavior differs between SQL batching and SyncState sources.
- Upstream head advancing: confirm the stream continues past the initial `until` and tracks the moving head.

## Unit tests

`tests/package-common/src/leader-thread/stream-events.test.ts`

- [x] Stream progresses as upstream head advances
- [x] Events get filtered by name
- [x] Events streamed until specific upstream head includes it then finalizes
- [x] Events streamed since local head doesn't include local head
- [x] Events get filtered by client ID
- [x] Events get filtered by session ID
- [x] Client only events get filtered out
- [x] Correctly streams events across batches (property based test)

## Integration tests

`packages/@livestore/livestore/src/store/store-eventstream.test.ts`

- [x] Stream resumes when reconnected to sync backend

## Performance tests

`tests/perf-eventlog/tests/suites/event-streaming.test.ts`

- [x] Latency test (1000 events)
- [x] Large event log 10K (requires pre-generating snapshot)
- [x] Large event log 100K (requires pre-generating snapshot)