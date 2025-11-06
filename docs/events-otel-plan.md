# OTEL Opportunities for streamEvents

## Existing Instrumentation
- stream events RPCs already run under `Stream.withSpan` in both worker adapters (`@livestore/adapter-web` and `@livestore/adapter-node`), so every consumer gets a top-level span.
- Leader sync operations rely on `Effect.withSpan` throughout `LeaderSyncProcessor.ts`, providing coverage for push/pull, boot, backend flow, etc.
- The store layer still bootstraps the root, commit, and query spans via direct `@opentelemetry/api` calls, but those spans never carry into the leader thread.

## Observed Gaps
- `streamEventsWithSyncState` returns raw segments with no span metadata. Head advances, batch counts, and filter combinations are invisible to telemetry.
- `streamEventsFromEventlog` fetches SQLite batches synchronously; the current `Stream.unfold` wrapper offers no spans around the expensive query work, so latency and row counts are invisible.
- Store-to-leader traces do not propagate a shared OTEL context, meaning segments fetched in the leader thread appear as disconnected traces relative to `Store.eventsStream`.

## Recommendations
1. **Segment-level spans in `stream-events.ts`**
   - Wrap each emitted segment with `Stream.withSpan('@livestore/common:streamEvents:segment', attrs)`.
   - Attributes worth recording: cursor bounds, effective head, configured batch size, filter counts, `includeClientOnly`, and whether the segment was triggered by head advancement vs. bounded `until`.
   - Ensures every adapter reusing the helper gets consistent, centralized telemetry.

2. **Batch-fetch spans in `eventlog.ts`**
   - Switch the `Stream.unfold` to `Stream.unfoldEffect`, shift the database call into an `Effect`, and wrap it with `Effect.withSpan('@livestore/common:eventlog:fetchBatch', attrs)`.
   - Attributes: offset, batch size, actual row count, `since`/`until` global sequence, filter/client/session counts.
   - Captures the real bottleneck (SQLite query) without duplicating logic elsewhere.

3. **Context propagation option**
   - If modifying shared helpers is risky, extend `StreamEventsFromEventLogOptions` with `otelContext?: otel.Context` and pass it through adapters. Linking the worker spans to the store’s query span provides end-to-end traces, but you still miss per-batch visibility.

## Suggested Next Steps
- Pick either the helper-based instrumentation (preferred) or the propagation-only approach depending on rollout comfort.
- Prototype spans locally, verify they appear (including attributes) in your OTEL backend, and adjust naming before rolling into production layers.
- Once the shared helpers emit spans, consider adding test or dev tooling hooks to assert acceptable batch durations using the new telemetry data.