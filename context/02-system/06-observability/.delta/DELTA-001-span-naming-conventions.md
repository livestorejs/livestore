# DELTA-001 — Span naming conventions diverge from the namespacing contract

Status: open

## Divergence

LS.SYS.OBS-R05 requires every LiveStore span name to carry the
`@livestore/<pkg>:` prefix. Four incompatible conventions coexist today
(see the spec's span inventory):

- namespaced `@livestore/<pkg>:<area>:<op>` (the target form);
- bare generic names — `LiveStore`, `LiveStore:<storeId>`, `createStore`,
  `createStore:boot`, `createStore:makeAdapter`, `LiveStore:commits`,
  `LiveStore:queries`, `LiveStore:commit`;
- colon-lowercase — `client-session-sync-processor:pull`,
  `localPushProcessingDelay`;
- CamelDot — `StoreRegistry.getOrLoad:<storeId>`,
  `StoreRegistry.lookup:<storeId>`, `LSD.devtools.onMessage`.

Bare names can collide with app spans in a shared trace.

## VRS

[requirements.md](../requirements.md) LS.SYS.OBS-R05 (adopted 2026-07-16,
interview).

## Implementation Contract

Rename all non-conforming span names to `@livestore/<pkg>:<area>:<op>` and
keep the spec's span inventory in sync. Close this delta when a grep for
LiveStore-emitted span names finds only prefixed forms (test-only
`MockSyncBackend:*` spans excluded).
