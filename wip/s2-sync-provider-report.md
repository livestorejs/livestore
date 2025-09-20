S2 Sync Provider — Issues & Notes

Context: Implemented an official S2-backed API proxy for the LiveStore sync-provider tests, using the hosted S2 HTTP API with push/pull over JSON and live pulls via SSE.

What’s implemented
- API proxy HTTP server that maps LiveStore push/pull/ping to S2 streams:
  - Basin: unique per test run (`ls-<timestamp>-<rand>`)
  - Stream: per-test unique from `storeId` (sanitized)
  - Push: S2 `append` (JSON) with `s2-format: raw`
  - Pull: S2 `read` (JSON) for non-live; SSE tail for live
  - Ping: HEAD 200 (connectivity implied by subsequent operations)
- Token handling: uses `S2_ACCESS_TOKEN` env if set; otherwise defaults to the provided token. No secrets are logged.

Issues encountered and mitigations
- Stream creation races (“already exists”): proxy creates stream before append/read and ignores idempotent conflicts.
- Latency/timeout in tests: mitigated by batched reads (`count: 1000`) and early empty-page emission on live.
- Fresh env per test: achieved with per-run basin and per-test unique stream, ensuring no cross-test contamination.

Follow-ups / potential enhancements
- Consider HEAD ping implementation that probes S2 (e.g., `list-basins --limit 1`) to surface connectivity.
- Optionally delete basins after tests to reduce account clutter (defaults to delete; keep via `LIVESTORE_S2_KEEP_BASINS=1`).
- Stream creation policy: explore basin `create_stream_on_append` if we want to skip explicit creation.
