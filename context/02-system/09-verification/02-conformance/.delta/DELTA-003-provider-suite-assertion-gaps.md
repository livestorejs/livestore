# DELTA-003 — Provider-suite assertion gaps

Status: open

## Divergence

LS.SYS.VER.CONF-R05 requires the sync-provider suite to assert
reconnection-after-drop and auth-failure behavior per provider. The suite
(`tests/sync-provider/src/sync-provider.test.ts`) runs a `connection management
> can reconnect to sync backend` test for all seven registry providers (`:415`),
but `turnBackendOffline` is a no-op `Effect.log('TODO')` stub for the six
Cloudflare providers — only the mock provider genuinely drops the backend
(`mock.ts:47`) — so drop/resume is meaningfully exercised for 1 of 7.
Auth-failure assertions are absent.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.CONF-R05 (adopted
2026-07-16, interview).

## Implementation Contract

Make `turnBackendOffline` genuinely drop the backend for the six Cloudflare
providers (not a `TODO` stub) so the existing reconnection test exercises real
drop/resume for all seven; and add an auth-failure spec: push/pull with a
rejecting auth payload → typed failure surfaced (not a hang). Close when
drop/resume and auth-failure both run for all seven registry providers in CI.
