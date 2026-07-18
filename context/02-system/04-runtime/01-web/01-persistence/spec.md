# Web Persistence — Spec

This document specifies persistence and identity in the browser adapter. It
builds on [requirements.md](./requirements.md); topology and leadership are
siblings ([../02-topology/](../02-topology/spec.md),
[../03-leadership/](../03-leadership/spec.md)).

## Status

Draft.

## OPFS Databases

The leader worker owns two OPFS-backed SQLite databases
(`web-worker/leader-worker/make-leader-worker.ts:214-254`), both on the
AccessHandlePoolVFS (single connection per database):

- **State DB** — file name `state<suffix>.db` where `suffix` is the state
  schema hash, or the literal `fixed` under the `manual` migration strategy
  (`web-worker/common/persisted-sqlite.ts:125-129`;
  LS.SYS.RT.WEB.PERSIST-R02). A schema change under `auto` therefore opens
  a fresh file, which is what makes the leader see `dbStateMissing` and
  rebuild — the trigger chain specified in
  `../../../02-state/01-sqlite/02-schema-management/`.
- **Eventlog DB** — fixed file name `eventlog.db`; versioned only by
  `liveStoreStorageFormatVersion` (see the schema-management node for the
  asymmetry).

Old state-db files are archived/cleaned on leader boot
(`cleanupOldStateDbFiles`, keeping at most `MAX_ARCHIVED_STATE_DBS_IN_DEV
= 3` in dev) to avoid exhausting the OPFS access-handle pool.

## Storage Probes and Fallback

Two independent OPFS probes run (`checkOpfsAvailability`): the client
session probes before deciding the fast path and the app-visible
`storageMode`; the leader worker probes to decide actual DB backing and, on
failure, creates in-memory databases plus a `bootStatus` warning with a
`BootWarningReason` (`private-browsing` on `SecurityError`/
`NotAllowedError`, else `storage-unavailable`). The dual-probe divergence
risk is contracted at the parent level (`LS.SYS.RT-R16`,
[../../.delta/DELTA-002-dual-storage-probes.md](../../.delta/DELTA-002-dual-storage-probes.md)).

## Fast-Path Snapshot Read

Unless disabled or OPFS is unavailable, a booting session reads the
persisted state DB directly from OPFS
(`readPersistedStateDbFromClientSession`) instead of requesting a
`GetRecreateSnapshot` from the leader, and derives its initial leader head
from `SESSION_CHANGESET_META_TABLE` rather than the eventlog
(`persisted-adapter.ts:238-249,464-483`). Any read error falls back to the
slow path. The snapshot is currently trusted without validation — see
`LS.SYS.RT-R15` and
[../../.delta/DELTA-001-fast-path-unvalidated.md](../../.delta/DELTA-001-fast-path-unvalidated.md).

## Identity Keys

Both persisted variants derive identity via `getPersistedId`
(`persisted-adapter.ts:593-620`; LS.SYS.RT.WEB.PERSIST-R04):

- `clientId` — `localStorage` key `livestore:clientId:<storeId>`, shared by
  all tabs of the origin, created once as `nanoid(5)`.
- `sessionId` — `sessionStorage` key `livestore:sessionId:<storeId>`, per
  tab; survives reloads and same-tab restores; a new tab gets a fresh id.
  Browser tab duplication copies `sessionStorage`, so a duplicated tab
  inherits the same `sessionId` (platform behavior, not guarded).
- Non-window contexts fall back to a fresh random id per boot.

`resetPersistence` deletes the persisted databases and broadcasts an
intentional shutdown (`adapter-reset`) first
(LS.SYS.RT.WEB.PERSIST-R03); it is skipped with a warning when storage is
unavailable (`persisted-adapter.ts:221-230`).
