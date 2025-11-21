# LiveStore Streaming Perf Harness (Loopback)

The `perf-streaming-loopback` package hosts a copy of the streaming perf harness wired to an in-process confirmation backend. Instead of proxying through Cloudflare Durable Objects, the app mounts a loopback sync layer powered by `makeMockSyncBackend`, which immediately replays pushed events as confirmed payloads.

## Commands

- `pnpm dev` – run the Vite dev server hitting the loopback backend.
- `pnpm build` – build the React app for production.
- `pnpm preview` – serve the built app locally.

The original Cloudflare-based harness remains in `tests/perf-streaming` if you need to validate behaviour against the real worker transport. This loopback variant is intended for fast local perf profiling without external infrastructure.

## Snapshot loading

Export state + eventlog SQLite snapshots from LiveStore Devtools and load them directly into the harness to avoid waiting for millions of events to materialize:

1. Click **Load snapshots** in the control panel and select the matching state and eventlog `.db` files. The harness restarts automatically once both imports finish.
2. For automation (Playwright or manual scripts), call `window.__livestorePerfHarness.loadSnapshots({ state, eventlog })` with `Uint8Array`/`ArrayBuffer` payloads. This bypasses the UI entirely and issues the paired `LoadDatabaseFile` requests atomically.

### Playwright configuration

`tests/perf-streaming-loopback/tests/suites/simple-streaming.test.ts` can preload snapshots when the following environment variables are set:

- `LIVESTORE_PERF_STATE_SNAPSHOT` – absolute path to the exported state database.
- `LIVESTORE_PERF_EVENTLOG_SNAPSHOT` – absolute path to the exported eventlog database.
- `LIVESTORE_PERF_EXPECTED_EVENT_COUNT` – number of events contained in the snapshot (used for assertions).

When these variables are unset, the test falls back to seeding 500 events through the harness UI, preserving the previous behaviour.

## Memory profiling attempts

We experimented with a few ways of capturing worker memory usage from Playwright:

- **Chrome DevTools Protocol sessions** – Playwright can only attach CDP sessions to the main page/frames, not to dedicated workers (see [microsoft/playwright#22992](https://github.com/microsoft/playwright/issues/22992)). That means `Runtime.getHeapUsage` is limited to the main thread when driven through Playwright.
- **`performance.measureUserAgentSpecificMemory()`** – This API *does* expose per-scope totals (Window, DedicatedWorkerGlobalScope, etc.) once the app is cross-origin isolated, but every call is coordinated with garbage collection. The promise resolves only after GC runs and reports the memory that survived that GC cycle, so it captures “steady state after GC” rather than peak usage. In headless Chromium the method is disabled entirely, and even in headed runs the numbers flatten quickly once the worker releases its buffers.

Because neither approach reports the high-water allocation values we see in DevTools’ live heap view, we removed the automated memory tracking for now. Revisiting this will likely require instrumentation inside the worker itself (e.g., logging allocated buffer sizes) or a different test harness that can attach CDP sessions directly to worker targets.
