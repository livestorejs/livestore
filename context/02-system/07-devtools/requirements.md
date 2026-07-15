# Devtools — Requirements

Defines the devtools protocol — how tooling inspects and controls a running
LiveStore client — and the contract for devtools surfaces. Refines the
transparency requirement of the root ([LS-R13]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). Transport is
webmesh (`../04-runtime/`); telemetry semantics are `../06-observability/`.
The devtools UI ships through a separate artifact pipeline (see
`../../03-delivery/`); opening much of that UI as a component kit is roadmap
(root `roadmap.md`).

## Requirements

- **LS.SYS.DT-R01 Protocol-first:** Devtools communicate with clients only
  through versioned, schema-defined messages (client-session and leader
  namespaces); no privileged in-process access.
- **LS.SYS.DT-R02 Explicit compatibility:** Handshakes carry a devtools
  protocol version; unsupported versions are rejected deterministically, and
  legacy peers without a version are treated as protocol 1.
- **LS.SYS.DT-R03 Inspection surface:** Devtools can browse the eventlog,
  inspect state, and observe sync/network status and session identity for any
  connected client. `refines: LS-R13`
- **LS.SYS.DT-R04 Control surface:** Devtools can issue explicit control
  operations (e.g. database reset, sync latches for simulating offline) that
  are distinguishable from app-originated behavior.
- **LS.SYS.DT-R05 Pluggable surfaces:** Surfaces attach over webmesh channels
  discovered by node naming; the web channel ships in-repo, other surfaces
  (e.g. Expo devtools) are contrib realizations (stub pending LS-DQ2).
- **LS.SYS.DT-R06 Session discovery:** Running sessions announce identity
  (store, client, session, schema alias, leader flag, origin) so surfaces can
  enumerate and target them without app cooperation.
