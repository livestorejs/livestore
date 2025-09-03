Investigation: CI-only failure in node-sync integration tests

Owner: Codex CLI agent

Status
- Active hypotheses are tracked in per-file docs under `debug/hypotheses/`.
- Test loop uses env-driven overrides to keep CI iterations fast.

Index
- H001: ServerAheadError push/pull deadlock
- H002: Wrangler dev/inspector and orphaned processes
- H003: Resource limits (ulimit/memory/CPU)
- H004: Logger RPC port collision
- H005: Version drift (wrangler/workerd/node/bun)

Quick Repro (CI-like)
- CI mode, 1 run, default debug params:
  CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 mono test integration node-sync

Where to look
- Node-sync logs: `tests/integration/tmp/logs/*.log` (uploaded as CI artifact)
- CI job env summary in `.github/workflows/ci.yml` > Debug environment info

