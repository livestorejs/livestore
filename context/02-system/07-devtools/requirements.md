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
  protocol version; an unsupported version is answered with a
  `VersionMismatch` reply (never a half-working session), and legacy peers
  without a version are treated as protocol 1. Only the handshake is
  version-gated (see spec).
- **LS.SYS.DT-R03 Inspection surface:** Devtools can browse the eventlog,
  inspect state, and observe sync/network status and session identity for any
  connected client. `refines: LS-R13`
- **LS.SYS.DT-R04 Control surface:** Devtools can issue explicit control
  operations (database reset, database import, event injection, sync latches
  for simulating offline); every control operation is an explicit protocol
  message, never inferred behavior. (Attribution of imported data is
  currently incomplete — see LS.SYS.DT-R09 and
  [.delta/DELTA-001-import-unattributed.md](./.delta/DELTA-001-import-unattributed.md).)
- **LS.SYS.DT-R05 Pluggable surfaces:** Surfaces attach over webmesh channels
  discovered by node naming; the web channel ships in-repo, other surfaces
  (e.g. Expo devtools) are contrib realizations — see
  [realizations.md](./realizations.md).
- **LS.SYS.DT-R06 Session discovery:** Running sessions announce identity
  (store, client, session, schema alias, leader flag, origin) so surfaces can
  enumerate and target them without app cooperation.
- **LS.SYS.DT-R07 Idempotent delivery:** Every request-bearing message
  carries a `requestId`; handlers are idempotent under duplicate delivery
  (the proxy transport is at-least-once). Adopted 2026-07-16 (interview).
- **LS.SYS.DT-R08 Subscription lifecycle:** Streaming inspection uses
  explicit `Subscribe`/`Unsubscribe` messages keyed by `subscriptionId`; all
  subscriptions of a peer drop on `Disconnect`. Adopted 2026-07-16
  (interview).
- **LS.SYS.DT-R09 Destructive-op accounting:** Every state-mutating devtools
  operation is enumerated in the protocol catalog and attributable as
  devtools-originated. Adopted 2026-07-16 (interview); database import is
  not attributable today — see
  [.delta/DELTA-001-import-unattributed.md](./.delta/DELTA-001-import-unattributed.md).
- **LS.SYS.DT-R10 Discovery liveness:** Session discovery is poll plus TTL
  eviction; a non-responsive session disappears from surfaces within the
  stale window. Adopted 2026-07-16 (interview). `refines: LS.SYS.DT-R06`
- **LS.SYS.DT-R11 Side-effect-free inspection:** Inspection operations must
  not mutate engine state observable to other readers. Adopted 2026-07-16
  (interview); debug-info reads currently reset shared state — see
  [.delta/DELTA-002-debuginfo-reset-on-read.md](./.delta/DELTA-002-debuginfo-reset-on-read.md).
- **LS.SYS.DT-R12 Transport enumeration:** The spec's surfaces contract
  names all supported transports (web channel, browser-extension bridge,
  Expo webmesh proxy); adding a transport is a spec change, never an
  undocumented side door. Adopted 2026-07-16 (interview).
