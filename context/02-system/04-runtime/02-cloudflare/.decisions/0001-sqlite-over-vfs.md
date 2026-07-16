# 0001 — WASM SQLite over a DO-storage VFS, not DO SQLite directly

Status: accepted (2025 CF design exploration; recorded 2026-07-16).

## Context

The leader thread needs the same SQLite engine surface on Cloudflare as on
other platforms: session-extension changesets for rebase rollback,
serialize/deserialize, prepared statements, and transaction semantics. The
Durable Object `SqlStorage` API exposes only a narrow `exec` surface.

## Options

- **(a) Layered SQLite: the shared WASM build persisting pages through a
  custom VFS into DO storage — chosen.** `CloudflareDurableObjectVFS`
  stores pages as `vfs_pages` rows; required pragmas minimize billable page
  writes; the engine keeps full wa-sqlite capabilities (changesets,
  identical query/materialization behavior across realizations,
  LS.SYS.RT-R09 / LS.SYS.RT.CF-R04).
- **(b) Use DO SQLite (`SqlStorage`) directly as the engine.** Rejected:
  not feasible — the exploration notes record it as unworkable, and the
  surviving direct-`SqlStorage` path (the eventlog DB) shows why the state
  engine cannot live there: no session extension/changesets, no
  serialize/deserialize (`export()`/`import()` are no-ops), and transaction
  control statements are silently dropped
  (`make-sqlite-db.ts`; [spec.md](../spec.md) §Platform Adaptations).

## Evidence

Design exploration notes (2025 CF work, formerly `wip/2025-cf.md`).
Implementation evidence: `make-adapter.ts` builds `dbState` over the VFS
while only the append-only, rebuild-safe eventlog uses `storage.sql`
directly.

## Consequences

- Every state-DB page write is a billable `vfs_pages` row write; the
  required pragmas (`journal_mode=MEMORY`, `synchronous=OFF`, …) exist to
  bound that cost, trading crash-journal safety for rebuildability.
- The mixed design is deliberate: full-featured engine for state, narrow
  direct storage for the eventlog.
