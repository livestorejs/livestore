# OTEL Opportunities for streamEvents

## Existing Instrumentation
- stream events RPCs already run under `Stream.withSpan` in both worker adapters (`@livestore/adapter-web` and `@livestore/adapter-node`), so every consumer gets a top-level span.
- Leader sync operations rely on `Effect.withSpan` throughout `LeaderSyncProcessor.ts`, providing coverage for push/pull, boot, backend flow, etc.
- The store layer still bootstraps the root, commit, and query spans via direct `@opentelemetry/api` calls, but those spans never carry into the leader thread.

## Observed Gaps
- `streamEventsWithSyncState` paginates via `Stream.paginateChunkEffect`, but every iteration just returns the chunk from `Eventlog.getEventsFromEventlog` with no span metadata. Head advances, batch counts, queue waits, and filter combinations are invisible to telemetry.
- `getEventsFromEventlog` still issues SQLite reads synchronously. The `dbEventlog.select` call and chunk encoding have no spans, so latency and row counts are hidden.
- Store-to-leader traces do not propagate a shared OTEL context, meaning segments fetched in the leader thread appear as disconnected traces relative to `Store.eventsStream`.

## Recommendations
1. **Segment-level spans in `stream-events.ts`**
   - Inside the `Stream.paginateChunkEffect` step, wrap the effect that computes `chunk` and `nextState` with `Stream.withSpan('@livestore/common:streamEvents:segment', attrs)`.
   - Attributes worth recording: current cursor/global bounds, the chosen `target`, batch size, filter counts, `includeClientOnly`, queue wait vs. immediate advance, number of rows returned, and whether the segment was triggered by head advancement vs. bounded `until`.
   - Enables every adapter reusing `streamEventsWithSyncState` to emit consistent batch telemetry without duplicating instrumentation.

2. **Batch-fetch spans in `eventlog.ts`**
   - Lift the body of `getEventsFromEventlog` into an effect (`Effect.suspend` or a new effectful helper) so the `dbEventlog.select` call can be wrapped by `Effect.withSpan('@livestore/common:eventlog:fetchBatch', attrs)`.
   - Attributes: `since`/`until` globals, batch size, row count, filter/client/session counts, and whether client-only rows were excluded.
   - Captures the real bottleneck (SQLite query plus encoding) without duplicating logic elsewhere and feeds useful attributes back to the segment span above.

3. **Context propagation option**
   - If modifying shared helpers is risky, extend `StreamEventsOptions` with `otelContext?: otel.Context` and pass it through adapters. Linking the worker spans to the store’s query span provides end-to-end traces, but you still miss per-batch visibility.

## Suggested Next Steps
- Pick either the helper-based instrumentation (preferred) or the propagation-only approach depending on rollout comfort.
- Prototype spans locally, verify they appear (including attributes) in your OTEL backend, and adjust naming before rolling into production layers.
- Once the shared helpers emit spans, consider adding test or dev tooling hooks to assert acceptable batch durations using the new telemetry data.