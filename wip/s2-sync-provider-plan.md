# S2 Sync Provider — Implementation Plan

This plan proposes adding a new sync provider for S2 (s2.dev) to LiveStore, delivered as a new mono-repo package and integrated into the existing sync-provider test suite alongside Cloudflare and Electric.

## Goals

- Provide a first-class `@livestore/sync-s2` package that implements the `SyncBackend` interface.
- Support reliable push/pull, ping/connect, and live pulling (where feasible) with robust error handling.
- Add comprehensive tests in `tests/sync-provider` covering functional parity with existing providers.
- Minimize friction to run locally and in CI (no secrets required by default; integration tests gated by env if needed).

## Non‑Goals (Initial Phase)

- Production deployment recipes for S2 infrastructure (docs links and basic guidance only).
- Advanced features (multi-region routing, precise remaining count in pagination) unless trivially supported by S2.
- Example apps beyond smoke usage; can be added after the core implementation stabilizes.

## Assumptions & Open Questions

- S2 offers an HTTP API that can be used (directly or proxied) to:
  - Pull a sequence of events for a store, possibly with pagination or streaming semantics.
  - Push a batch of events.
  - Probe liveness (HEAD/GET or a dedicated ping endpoint).
- If S2 supports long-poll/SSE/WebSocket for tailing, we can add a “live” pull mode similar to Electric/Cloudflare.
- Authentication/authorization strategy for tests: prefer local mode without secrets. If remote S2 is required, integration tests will be opt-in via env vars (e.g. `S2_PULL_URL`, `S2_PUSH_URL`, `S2_PING_URL`, `S2_API_KEY`).
- Data model alignment: events are globally ordered by `seqNum` and include `parentSeqNum`, `name`, `args`, `clientId`, `sessionId`. We’ll adapt encoding/decoding to S2’s expected payloads.

We will validate API specifics during implementation; plan includes an explicit discovery task.

## Deliverables

- New package `packages/@livestore/sync-s2` with:
  - `src/index.ts` exporting `makeSyncBackend(options)` that returns a `SyncBackend` implementation.
  - Optional helpers: `src/api-schema.ts` (shared request/response schemas), `src/make-s2-url.ts` (helper to construct pull URLs), and `LICENSE`, `README.md`, `tsconfig.json`, `package.json`.
  - Test-facing options for ping intervals/timeouts similar to Electric.
- New test provider module `tests/sync-provider/src/providers/s2.ts`:
  - Exports `name`, optional `prepare`, and `layer: SyncProviderLayer` mirroring Cloudflare/Electric style.
  - Supports two modes:
- Local API proxy mode (default) using a lightweight HTTP router that simulates S2 endpoints backed by local SQLite/Postgres (fast and deterministic).
    - Integration mode (opt-in) hitting a real S2 endpoint if env vars are set.
- CI hook: update `tests/sync-provider/src/prepare-ci.ts` to include the S2 provider `prepare` step (no-op by default; pulls any Docker images if the API proxy uses Docker).
- Short docs entry linking to S2 provider reference page stub (can be filled when API details are confirmed).

## High‑Level Architecture

- Client library (`@livestore/sync-s2`) follows the same shape as `@livestore/sync-electric`:
  - `makeSyncBackend({ endpoint, ping?, livePull? })` where `endpoint` can be a string or object `{ pull, push, ping }`.
  - `connect` initiates connectivity (HEAD/GET) or is a no-op if same-origin.
  - `pull(cursor, { live })` returns a stream of `{ batch, pageInfo }` items. Batch items carry per-event metadata if S2 returns it.
  - `push(batch)` posts a validated batch; maps errors to `InvalidPushError`/`IsOfflineError`.
  - `ping` checks liveness; keeps `isConnected` ref updated on success/failure.
  - `supports` flags set based on S2 capabilities:
    - `pullPageInfoKnown`: `true` only if S2 returns a known remaining count; otherwise `false`.
    - `pullLive`: `true` if S2 supports long-poll/SSE/WS; otherwise `false` (fallback to poll).

### Pull Mechanics (phased)

1) Phase 1: HTTP pull
   - GET `endpoint.pull?args=<json>` using a schema similar to Electric: `{ storeId, payload, live, handle/cursor? }`.
   - If S2 returns a cursor/handle in headers or body, propagate it as `metadata` for subsequent pulls.
   - Long-poll or periodic polling (configurable) for `live` mode.

2) Phase 2: Streaming (optional)
   - If S2 supports SSE or WebSocket, add a transport to improve latency and reduce polling.
   - Maintain parity with `pull({ live: true })` contract used in tests.

### Push Mechanics

- POST `endpoint.push` with validated batch payload (mirroring `@livestore/sync-electric`’s `ApiSchema.PushPayload`).
- Map non-2xx to `InvalidPushError` with helpful diagnostics.
- Consider idempotency/retry behavior; document expectations.

### Ping/Connect

- HEAD/GET `endpoint.ping` to assert reachability; timeout and schedule configurable.
- Periodic ping (default 10s) to keep `isConnected` fresh; disable via options.

### Errors, Metadata, Capabilities

- Error mapping identical to other providers (`InvalidPullError`, `InvalidPushError`, `IsOfflineError`, `UnexpectedError`).
- `metadata`: `{ name: '@livestore/sync-s2', description, protocol, endpoint }` for devtools.
- `supports.pullPageInfoKnown`: set based on S2 API. If unknown initially, default to `false`.
- `supports.pullLive`: `true` only if S2 supports long-lived subscriptions.

## Test Strategy

- Add `tests/sync-provider/src/providers/s2.ts` modeled after `electric.ts`:
  - Local API proxy implementation for the test runner that:
    - Provides GET pull, POST push, HEAD ping.
    - Stores events in an ephemeral DB (SQLite/Postgres) keyed by `storeId`.
    - Supports `live: true` either via quick polling or request/stream multiplexing.
  - Integration mode toggled by env (e.g. `RUN_S2_INTEGRATION=1`) to hit a real S2 host/credentials. Tests will automatically skip when env isn’t set so CI remains stable.
- Plug into the shared test suite (`tests/sync-provider/src/sync-provider.test.ts`) by exporting `layer` and adding it to `providerLayers`.
- Extend `tests/sync-provider/src/prepare-ci.ts` with `S2.prepare` to pre-pull docker images if we choose a Postgres-based API proxy similar to Electric; no-op otherwise.
- Ensure all core tests pass:
  - Create/connect/ping lifecycle.
  - Pull with and without cursor.
  - Live pull pageInfo semantics (at least emits one “no-more” page).
  - Push + subsequent pull correctness.
  - Connection management (offline/online toggling).
  - Remaining count logic consistent with provider capabilities.

## Implementation Plan (Step‑By‑Step)

1) API discovery and design decisions
   - Validate S2 endpoints and auth model.
   - Decide initial transport: HTTP pull/push (Phase 1) and whether to add SSE/WS (Phase 2).
- Decide if local API proxy uses SQLite/Postgres; prefer SQLite for speed unless Postgres mirrors S2 behavior better.

2) Scaffold package `@livestore/sync-s2`
   - `package.json` (name, exports, deps aligned with `@livestore/sync-electric`).
   - `tsconfig.json`, `LICENSE`, `README.md` with basic usage.
   - `src/index.ts` with a skeleton `makeSyncBackend` returning a `SyncBackend`.
   - Optional: `src/api-schema.ts`, `src/make-s2-url.ts` if we need URL builders or request schemas.

3) Implement core client
   - Implement `ping`, `connect`, `push`, and `pull` (non-streaming) with error mapping.
   - Add basic live mode via polling; expose `pollInterval` in options.
   - Add `supports` flags and `metadata`.

4) Local API proxy provider for tests
   - Implement a lightweight HTTP router (node http + `@livestore/utils` HttpRouter) that:
     - GET pull: returns events > cursor with optional pagination.
     - POST push: validates and stores events.
     - HEAD ping: always 200 when running.
   - Optionally support `live: true` via polling or server push; start with polling for reliability in CI.

5) Test integration
- Add `tests/sync-provider/src/providers/s2.ts` exporting `name`, `prepare`, and `layer` that wires the API proxy and returns `makeSyncBackend({ endpoint: proxyUrl })`.
   - Add to `providerLayers` in `sync-provider.test.ts`.
   - Update `prepare-ci.ts` to include `S2.prepare`.
   - Verify tests locally via `vitest run tests/sync-provider` and `direnv exec . mono test unit` as needed.

6) Optional Phase 2: Streaming transport
   - If S2 supports SSE/WS for tailing, add a streaming path behind `supports.pullLive = true` and keep polling as fallback.

7) Docs and examples
   - Add `README.md` to the package with quick start, options, and environment variables.
   - Add docs stub under `docs/src/content/docs/reference/sync-provider/s2.md` (structure matching Cloudflare/Electric docs).
   - Optional: add a minimal example project later (web/node) using `@livestore/sync-s2`.

## Testing & CI

- Local
  - `direnv allow` (once), then `direnv exec . mono ts --clean && direnv exec . mono lint && vitest run tests/sync-provider`.
  - To target a single test: `vitest run tests/sync-provider/src/sync-provider.test.ts --testNamePattern "S2"`.
- CI
  - `prepare-ci.ts` runs `S2.prepare` (no-op or docker pull) to stabilize runs.
  - Integration tests against real S2 run only when `RUN_S2_INTEGRATION=1` and required env vars are present; otherwise skipped.

## Risks & Mitigations

- Unknown S2 API specifics: keep Phase 1 generic and API-proxy–based; abstract endpoints via options.
- Flaky live/streaming: default to polling first; add streaming later.
- Env/secret handling: default to local API proxy; gate real S2 tests via env; do not leak secrets in CI logs.
- Pagination semantics: if S2 cannot return remaining count, default to `pageInfoMoreUnknown` and assert parity with Electric tests.

## Timeline (Rough)

- Day 0.5: Discovery and scaffolding.
- Day 1: Core client (HTTP pull/push/ping) + local API proxy.
- Day 1.5: Tests green locally and in CI; docs stub.
- Day 2+: Optional streaming transport and example app.

## Next Steps (for this repo)

- Confirm S2 API details or proceed with Phase 1 generic endpoints.
- I’ll scaffold `@livestore/sync-s2`, add the API-proxy–backed test provider, and wire the test suite. Then we can iterate on any S2‑specifics.
- HTTP-only API proxy (done).
- Implement SSE tailing for live pulls in the API proxy (done).
- Switch client to prefer SSE for live pulls (done).
- Add headers `s2-format: raw` consistently and decode REST error bodies for better diagnostics.
- Add retries/backoff for transient HTTP failures (5xx/429) and solidify create-stream vs append race handling.
- Add OTEL spans/structured logs around REST calls.
- Revisit OpenAPI generated client usage once tool supports JSON Schema boolean forms; replace hand-rolled calls.

---

## Progress Log

- [x] Scaffolded `@livestore/sync-s2` package with minimal HTTP-based SyncBackend (pull/push/ping/connect), plus live via SSE, supports flags, metadata.
- [x] Implemented in-memory API proxy server under `tests/sync-provider/src/providers/s2.ts` with GET pull, POST push, and HEAD ping.
- [x] Wired S2 provider into test suite (`providerLayers`) and CI prepare step.
- [x] Added workspace + TS references; updated tests package deps for required effect/opentelemetry peer deps.
- [x] Fixed pull cursor progression bug (ensured subsequent pulls advance the cursor and streams terminate when not live).
- [x] Verified S2 provider tests pass in isolation:
- Command: `vitest run tests/sync-provider/src/sync-provider.test.ts --testNamePattern "S2 API Proxy"`
- [!] Running the entire sync-provider suite shows a pre-existing ElectricSQL timeout in `beforeAll` (likely Docker not available); unrelated to S2.

## Checklist (Phase 1)

- [x] Package scaffold
- [x] Basic HTTP client (pull/push/ping/connect)
- [x] Live pull via SSE
- [x] Test provider API proxy (in-memory)
- [x] Suite wiring + CI prepare
- [x] Cursor handling correctness
- [x] Tests green for S2-only
- [x] Docs stub added under docs/reference/sync-provider/s2.md
- [x] Basin cleanup after tests with opt-out via `LIVESTORE_S2_KEEP_BASINS=1`
- [ ] Docs stub (`docs/.../s2.md`)
- [ ] Example app (optional)

## Notes

- The ElectricSQL suite can be flaky or require Docker; our S2 provider is independent and passes its tests. We can add an env gate to skip Electric during local runs if desired.
