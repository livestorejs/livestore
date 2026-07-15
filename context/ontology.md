# LiveStore — Ontology

## Language

- **Event** — An immutable record of a domain fact, committed to a store and
  appended to its eventlog. Every event is either synced or client-only.
- **Event definition** — The schema declaring an event type: name, payload
  schema, sync scope, and associated materializer.
- **Synced event** — An event distributed to other clients of the same store
  via the sync backend.
- **Client-only event** — An event that stays on the committing client and is
  never pushed upstream.
- **Eventlog** — The append-only, totally ordered log of committed events for
  one store; the source of truth all state derives from.
- **Event sequence number** — The composite position of an event in the
  eventlog: global part, client part, and rebase generation.
- **Materializer** — A pure function mapping an event to state changes; runs
  identically on every client. _Avoid:_ projector, event handler.
- **State** — Data derived from the eventlog via materializers and queryable
  by the app. "Read model" is the event-sourcing literature term for the same
  thing; State is canonical in LiveStore.
- **Client document** — A keyed document table shape for client-local/UI
  state with last-write-wins semantics, built on the SQLite state
  realization.
- **Store** — The app-facing entry point bundling eventlog, state, and
  reactivity for one `storeId`.
- **storeId** — The identifier that partitions data and sync scope; one
  eventlog exists per `storeId`.
- **Client** — A logical group of client sessions on one device/runtime that
  share local data; identified by `clientId`.
- **Client session** — One running instance within a client (e.g. a browser
  tab); identified by `sessionId`; hosts a store and its reactivity graph.
- **Leader thread** — The per-client role that owns persistence and sync;
  exactly one leader is active per client at a time.
- **Adapter (platform adapter)** — The realization of the runtime contract
  for one platform (web, Cloudflare, Node, Expo, …); instantiates client
  sessions and the leader.
- **Sync provider** — A package providing a sync backend plus the client
  transport to reach it.
- **Sync backend** — The central service that orders and distributes synced
  events for a `storeId`.
- **Sync processor** — The component reconciling local pending events with
  upstream events; one runs session-side and one leader-side.
- **Rebase** — Re-parenting local pending events onto newly pulled upstream
  events, incrementing their rebase generation.
- **Live query** — A reactive query over state (`queryDb`, `computed`,
  `signal`) that recomputes when its inputs change.
- **Reactivity graph** — The incremental computation graph that propagates
  state changes to live queries.
- **Devtools** — The tooling surface for inspecting eventlog, state, and sync
  status, connected via the devtools protocol.
- **Facts** _(experimental)_ — Declarative constraints an event sets,
  unsets, requires, or reads; input to ordering, compaction, and conflict
  detection.
- **Command** _(proposal, [RFC 0002](../contributor-docs/rfcs/0002-command-replay.md))_ —
  A replayable capture of user intent that re-validates against current state
  before producing events. "Intent" names the concept a command captures; it
  is not an API term while the design is a proposal.

## Structure

- **Derivation chain:** Event definition → Event → Eventlog → Materializer →
  State → Live query → App.
- **Containment:** A Client contains one or more Client sessions plus the
  Leader role; sessions reach the leader through a proxy.
- **Pluggable dimensions:** Adapter, Sync provider, Framework integration,
  State realization, Devtools surface — each is a contract with multiple
  realizations.
