# Web Runtime — Requirements

The browser realization of the runtime contract: worker-based topology with
OPFS persistence and multi-tab support. Refines
[../requirements.md](../requirements.md) (`LS.SYS.RT-*`).

## Requirements

- **LS.SYS.RT.WEB-R01 Worker isolation:** `refines: LS.SYS.RT-R01` — The
  leader runs in a dedicated leader worker; a shared worker mediates between
  tabs and the leader so the main thread never blocks on persistence or sync.
- **LS.SYS.RT.WEB-R02 Multi-tab clients:** `refines: LS.SYS.RT-R04` — Every
  tab is a client session of the same client; leadership and shared-worker
  liveness are coordinated through the Web Locks API so tab close/crash
  triggers handover.
- **LS.SYS.RT.WEB-R03 OPFS persistence with fallback:**
  `refines: LS.SYS.RT-R07` — Eventlog and state persist to OPFS; when OPFS
  is unavailable (e.g. private browsing) the adapter degrades to in-memory
  with an explicit boot warning.
- **LS.SYS.RT.WEB-R04 Deployment variants:** Besides the worker topology, the
  adapter offers single-tab and in-memory variants with the same session
  contract, so apps can trade multi-tab support for setup simplicity.
- **LS.SYS.RT.WEB-R05 Devtools channel:** The adapter exposes a devtools web
  channel (webmesh) so browser devtools can attach to sessions and leader
  (`refines: LS-R13`).
