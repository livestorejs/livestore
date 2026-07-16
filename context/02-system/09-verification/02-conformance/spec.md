# Conformance — Spec

This document specifies the conformance suites. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Sync-Provider Suite (the model)

`tests/sync-provider/src/sync-provider.test.ts` runs one spec set via
`describe.each` over the provider registry
(`src/providers/registry.ts`) — the realization-independent pattern the
other dimensions should copy. Registry (7 providers): `mock`,
`cf-http-{d1,do}`, `cf-ws-{d1,do}`, `cf-do-rpc-{d1,do}` — every Cloudflare
transport crossed with both storage engines.

What the suite asserts today (captured 2026-07-16):

- interface shape (`connect`, `pull`, `push`, `isConnected` present);
- connection lifecycle (`isConnected` false → `connect` → true);
- empty initial pull, cursor-based pull, live pull;
- large-batch handling (payload-size floors, multi-batch chunking counts).

Not asserted (assertions absent or commented out): reconnection after
connection drop, auth/payload failures, `pageInfo.remaining` semantics.
Provider-specific extras live beside the suite
(`cloudflare-http-specific.test.ts`).

## Missing Dimensions

No shared suites exist for adapters, framework integrations, or read-model
realizations; their coverage rests on browser-integration tests (web) and
colocated hook tests (react).

## Open Design Questions

- **LS.SYS.VER.CONF-DQ1 Missing dimension suites.** Adapter, framework
  integration, and read-model conformance suites (LS.SYS.VER.CONF-R02) do
  not exist yet — a contract/reality gap for this node. Moved from
  `LS.SYS.VER-DQ1`.
- **LS.SYS.VER.CONF-DQ2 Sync-suite assertion gaps.** Whether
  reconnection-after-drop, auth failure, and `pageInfo` semantics become
  required suite assertions for every provider is undecided.
