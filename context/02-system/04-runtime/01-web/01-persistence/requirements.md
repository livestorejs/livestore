# Web Persistence — Requirements

Role: owns how the browser realization persists and identifies — OPFS
databases, storage probes and fallback, state-db file naming, the fast-path
snapshot read, and identity keys. Refines
[../requirements.md](../requirements.md).

## Requirements

- **LS.SYS.RT.WEB.PERSIST-R01 OPFS persistence with fallback:** Eventlog and
  state persist to OPFS; when OPFS is unavailable (e.g. private browsing)
  the adapter degrades to in-memory with an explicit boot warning. Re-homed
  2026-07-16 from `LS.SYS.RT.WEB-R03`. `refines: LS.SYS.RT-R07`
- **LS.SYS.RT.WEB.PERSIST-R02 Hash-named state DB:** The state-DB file name
  embeds the state schema hash (or `fixed` under the manual migration
  strategy), so a schema change opens a fresh file and triggers
  rebuild-by-absence (see [spec.md](./spec.md) §OPFS Databases). Adopted
  2026-07-16 (interview). `refines: LS.SYS.STATE.SQLITE.SM-R01`
- **LS.SYS.RT.WEB.PERSIST-R03 Reset broadcasts first:** `resetPersistence`
  broadcasts an intentional `adapter-reset` shutdown to all contexts before
  deleting persisted data (see [spec.md](./spec.md) §Identity Keys). Adopted
  2026-07-16 (interview). `refines: LS.SYS.RT-R06`
- **LS.SYS.RT.WEB.PERSIST-R04 Scoped identity keys:** `clientId` is
  origin-scoped (`localStorage`, `livestore:clientId:<storeId>`) and
  `sessionId` tab-scoped (`sessionStorage`, `livestore:sessionId:<storeId>`)
  (see [spec.md](./spec.md) §Identity Keys). Adopted 2026-07-16 (interview).
