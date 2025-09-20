# S2 HTTP Proxy Work — Issues & Notes

This file tracks the remaining HTTP integration work for the S2 API proxy that the sync-provider tests use.

## Current state

- Basin/stream provisioning: HTTP path (Bearer) for create/get/delete works.
- Records (append/read):
  - HTTP path for append/read.
  - JSON page reads (`count` provided) return batches as expected.
  - Live tail via SSE is wired; client uses SSE for live pulls.

## Issues and TODOs

1) HTTP append returning 500 (observed sporadically)
   - Hypothesis: missing required header (e.g., `s2-format`), or transient create-stream vs append race.
   - Mitigation in proxy: create-stream-before-append and retry on failure; include `s2-format: raw` headers and log error bodies for diagnostics.
   - TODO: Include `s2-format: raw` header explicitly on append and read; parse error body to log helpful message.

2) SSE tailing (live pulls)
   - SSE tailing is implemented in the proxy and consumed by the client.
   - TODO: Harden parsing for multi-line `data:` blocks and typed events (`event: ping`, errors).

3) OpenAPI generation
   - `@tim-smart/openapi-gen` crashes on S2 spec (`items: false` => boolean JSON Schema).
   - Repro saved in `wip/s2-openapi-gen-repro.md`.
   - TODO: When tool supports boolean JSON Schema, generate a typed client and replace the handwritten HTTP.

4) Observability & hardening
   - TODO: add OTEL spans around HTTP calls; retries/backoff for 5xx/429; structured error logs for non-2xx.
   - TODO: idempotency/fencing options in append requests.

## Env toggles

- `S2_ACCESS_TOKEN`: bearer token for HTTP path.
- `LIVESTORE_S2_KEEP_BASINS`: `1` keeps basins after tests (by default they are deleted).

## Next steps

- Add `s2-format: raw` headers and robust error decoding.
- Done: SSE tailing in proxy for `live=true`; JSON batch for `live=false`.
