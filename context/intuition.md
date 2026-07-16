# LiveStore — Intuition

*For: contributors and agents working on LiveStore · Assumes: TypeScript
app-development background · Covers: the whole product and the intent-layer
map*

## The idea

LiveStore is an event-sourced, local-first data layer. Instead of treating
local data as a cache of a server database, the app appends immutable domain
events to a local, append-only eventlog — and everything else is derived from
it: queryable SQLite state, reactive UI updates, persistence, offline
operation, and sync. The server (a sync backend) only orders and distributes
events; it is never the source of truth.

## The model

```
        app code
   ────────────────
   store.commit(event)                      live queries ──► UI
          │                                      ▲
          ▼                                      │ reactive updates
   ┌─────────────────┐   materializers   ┌───────────────┐
   │    eventlog      │ ───────────────► │  SQLite state  │
   │  (append-only)   │                  │   (derived)    │
   └─────────────────┘                   └───────────────┘
          ▲ │
     pull │ │ push          (leader thread owns this edge)
          │ ▼
   ┌─────────────────┐
   │  sync backend    │  orders + distributes events per storeId
   └─────────────────┘
```

Committing an event applies its materializer to local state immediately
(optimistic, synchronous), while the leader persists it and pushes it
upstream in the background. Pulling upstream events may require a rebase:
local pending events are re-parented onto the newly received ones and their
materializer effects are recomputed.

## Invariants

- Confirmed history is immutable; pending (unconfirmed) events may still be
  re-parented by a rebase before they join it.
- Materializers are pure and deterministic: the same eventlog yields
  identical state on every client and platform.
- State is disposable: it can always be rebuilt from the eventlog, which is
  what makes read-model changes cheap.

## Where things run

A *client* (one device/runtime) contains one or more *client sessions* —
e.g. one per browser tab — each holding an in-memory SQLite database and a
reactivity graph for synchronous reads. Exactly one *leader thread* per
client owns the persisted eventlog, the persisted state database, and the
sync connection. On the web this maps to tabs (sessions) talking through a
shared worker to a leader worker; other platforms arrange the same roles with
their own primitives.

## Pluggable dimensions

The engine core is platform-, provider-, and framework-agnostic. Five seams
are explicit contracts with interchangeable realizations:

- **Adapters** — web, Cloudflare Durable Objects (core); Node, Expo, …
  (contrib).
- **Sync providers** — Cloudflare (core); ElectricSQL, S2, custom (contrib).
- **Framework integrations** — React (core); Solid, Svelte, … (contrib).
- **State realizations** — SQLite today; the contract permits others.
- **Devtools surfaces** — web channel (core); platform-specific surfaces
  (contrib).

## The intent-layer map

This directory is the root of LiveStore's intent layer. Six branches:

- `01-product/` — who LiveStore is for, when to use it, and when not.
- `02-system/` — the technical contracts: event model, state, sync, runtime
  topology, store/reactivity, observability, devtools, integrations,
  verification.
- `03-delivery/` — how the product ships: repo composition, packaging,
  release.
- `04-docs/` — how user-facing docs derive from this tree.
- `05-contributing/` — how people and proposals (RFCs) flow into the project.
- `06-sustainability/` — licensing, sponsorship, and staying maintained
  without a company.

Branches nest: subsystems with real surface area carry child nodes of their
own (e.g. sync splits into its pure merge core, its processors, and provider
realizations), each with its own `requirements.md`/`spec.md` and often an
`intuition.md` like this one. The formal contracts live in each node's
`requirements.md` and `spec.md`; [ontology.md](./ontology.md) is the
canonical vocabulary used throughout.
