# Web Runtime — Requirements

The browser realization of the runtime contract: worker-based topology with
OPFS persistence and multi-tab support. Refines
[../requirements.md](../requirements.md) (`LS.SYS.RT-*`).

## Context

Child nodes own the three mechanics:
[01-persistence](./01-persistence/requirements.md) (`LS.SYS.RT.WEB.PERSIST`),
[02-topology](./02-topology/requirements.md) (`LS.SYS.RT.WEB.TOPO`),
[03-leadership](./03-leadership/requirements.md) (`LS.SYS.RT.WEB.LEAD`).

Re-homed 2026-07-16: `LS.SYS.RT.WEB-R01` → `LS.SYS.RT.WEB.TOPO-R01`,
`-R02` → `LS.SYS.RT.WEB.LEAD-R01`, `-R03` → `LS.SYS.RT.WEB.PERSIST-R01`
(numbers retired).

## Requirements

- **LS.SYS.RT.WEB-R04 Deployment variants:** Besides the worker topology, the
  adapter offers single-tab and in-memory variants with the same session
  contract, so apps can trade multi-tab support for setup simplicity.
- **LS.SYS.RT.WEB-R05 Devtools channel:** The adapter exposes a devtools web
  channel (webmesh) so browser devtools can attach to sessions and leader.
  `refines: LS-R13`
