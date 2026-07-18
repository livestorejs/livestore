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

Adapter and framework-integration suites are now contracted
(LS.SYS.VER.CONF-R03/R04) with open deltas
([DELTA-001](./.delta/DELTA-001-adapter-conformance-missing.md),
[DELTA-002](./.delta/DELTA-002-framework-conformance-missing.md));
reconnection/auth assertions are contracted by LS.SYS.VER.CONF-R05
([DELTA-003](./.delta/DELTA-003-provider-suite-assertion-gaps.md)).

## Open Design Questions

- **LS.SYS.VER.CONF-DQ1 Read-model conformance.** What a read-model
  realization suite must prove is owned jointly with `LS.SYS.STATE-DQ1`
  (`../../02-state/requirements.md`); undecided until a second read-model
  realization is concrete. Narrowed 2026-07-16 from the broader
  missing-dimension question.
- **LS.SYS.VER.CONF-DQ2 `pageInfo` assertions.** Whether `pageInfo.remaining`
  semantics become required suite assertions is undecided (reconnection and
  auth are now contracted via R05).
