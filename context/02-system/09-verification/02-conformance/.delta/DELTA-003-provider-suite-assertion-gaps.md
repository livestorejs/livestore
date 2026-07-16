# DELTA-003 — Provider-suite assertion gaps

Status: open

## Divergence

LS.SYS.VER.CONF-R05 requires the sync-provider suite to assert
reconnection-after-drop and auth-failure behavior per provider. The suite
(`tests/sync-provider/src/sync-provider.test.ts`) asserts interface shape,
connection lifecycle, pull variants, and large-batch chunking; reconnection
and auth-failure assertions are absent or commented out.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.CONF-R05 (adopted
2026-07-16, interview).

## Implementation Contract

Extend the shared spec set with: forced connection drop → provider
reconnects and resumes the live pull without event loss; push/pull with a
rejecting auth payload → typed failure surfaced (not a hang). Close when
both assertions run for all seven registry providers in CI.
