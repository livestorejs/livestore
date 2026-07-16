# System — Spec

This document specifies the system architecture at overview level. It builds
on [requirements.md](./requirements.md). Subsystem contracts live in the
child nodes.

## Status

Draft.

## Scope

Defines: how the subsystems compose, and the leader ⇄ client-session
boundary at overview level.

Does not define: any subsystem's own contract (see child nodes), platform
specifics (`04-runtime/` realizations), or delivery concerns
(`../03-delivery/`).

## Architecture

```
            app code (UI, domain logic)
                 │ commit(event)              ▲ reactive query results
                 ▼                            │
  ┌─ 05-store ─────────────────────────────────────────┐
  │  Store · reactivity graph · live queries            │   08-integrations
  │  (client session, in-memory state)                  │ ◄─ framework wrappers
  │  03-sync: ClientSessionSyncProcessor                │
  └───────┬─────────────────────────────────▲───────────┘
          │ push events (proxy)             │ state updates
  ────────┼── leader ⇄ session boundary ────┼──── (04-runtime: workers,
          ▼                                 │      webmesh transport)
  ┌─ leader role ──────────────────────────────────────┐
  │  01-event-model: eventlog (append-only, persisted)  │
  │  02-state:       materializers → state DB           │
  │  03-sync:        LeaderSyncProcessor · pending queue│
  └───────┬────────────────────────────────▲───────────┘
          │ push batch                      │ pull stream (total order)
          ▼                                 │
       sync backend (03-sync provider realizations)

  06-observability instruments all layers · 07-devtools inspects/controls
  via its own protocol · 09-verification proves the contracts
```

## Child Nodes

| Node | Owns |
| --- | --- |
| `01-event-model/` | Event definitions, event shapes, sequence numbers, eventlog semantics, facts (experimental) |
| `02-state/` | Read-model dimension contract; children: `01-sqlite/` realization (+ `02-schema-management/`) |
| `03-sync/` | Provider contract boundary; children: `01-syncstate/` (pure merge core), `02-processors/`, `03-cf/` realization |
| `04-runtime/` | Leader/session topology, adapter + proxy contracts; children: `01-web/` (+ persistence/topology/leadership), `02-cloudflare/`, `03-webmesh/` |
| `05-store/` | App-facing Store, commit path, lifecycle, multi-store; child: `01-reactivity/` |
| `06-observability/` | Instrumentation contract, telemetry semantics |
| `07-devtools/` | Devtools protocol + surfaces contract |
| `08-integrations/` | Framework-integration contract; children: `01-react/`, `02-effect/` |
| `09-verification/` | Verification contract; children: lanes, conformance, performance, protocol-compat, determinism |

## Leader ⇄ Client-Session Boundary (overview)

Per client (`clientId`), one leader role owns the persisted eventlog, the
persisted state database, and upstream sync (LS.SYS-R04). Client sessions
(`sessionId`) each hold an in-memory state database driving their reactivity
graph and talk to the leader through a proxy. Committed events flow
session → leader → sync backend; confirmed/pulled events flow back
backend → leader → all sessions. Two sync-state machines of the same shape
run at the two boundaries (session⇄leader, leader⇄backend); their semantics
are owned by `03-sync/`, their placement by `04-runtime/`.
