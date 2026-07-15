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
- **Materializer** — A pure function of an event and current state, producing
  state changes; runs identically on every client. _Avoid:_ projector, event
  handler.
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
- **Changeset (SQLite session)** — A SQLite session-extension changeset
  recorded per materialization, used to roll back state during rebase.
- **Changeset (release)** — A pnpm changeset file describing a package-level
  change, folded into release notes.
- **BDFL** — Benevolent Dictator For Life: the project creator holds final
  decision authority; governance detail in `05-contributing/`.
- **Facts** _(experimental)_ — Declarative constraints an event sets,
  unsets, requires, or reads; input to ordering, compaction, and conflict
  detection.
- **Command** _(proposal,
  [RFC 0002](../contributor-docs/rfcs/0002-command-replay.md))_ — A
  replayable capture of user intent that re-validates against current state
  before producing events. "Intent" names the concept a command captures; it
  is not an API term while the design is a proposal.

## Structure

The **event** is the spine: every other concept produces events, orders
them, derives from them, or observes the result.

| Relation to the spine | Terms |
| --- | --- |
| Produce | Store (commit), Client session, Command _(proposal)_ |
| Order | Eventlog, Event sequence number, Sync backend, Rebase, Facts _(experimental)_ |
| Derive | Materializer, State, Client document |
| Observe | Live query, Reactivity graph, Devtools |

### Term families and leitwörter

Families group terms around an anchor; followers carry the anchor's leitwort
in their name:

- **Event family** (leitwort "event") — anchor **Event**; followers Event
  definition, Eventlog, Event sequence number, Synced event, Client-only
  event.
- **Client family** (leitwort "client") — anchor **Client**; followers
  Client session, Client document.
- **Sync family** (leitwort "sync") — no single anchor noun; Sync provider,
  Sync backend, Sync processor share the leitwort. Rebase is this family's
  operation term (no leitwort — it names the act, not a sync part).
- **State family** — anchor **State**; Materializer and Changeset (SQLite
  session) are its derivation vocabulary (mechanism names, no shared
  leitwort).
- **Store family** (leitwort "store") — anchor **Store**; follower storeId.
  Live query and Reactivity graph are its observation vocabulary.

### Naming rubric

- A new term that follows an existing anchor joins that family and carries
  its leitwort (e.g. anything scoped to one event starts with "event").
- A compound touching two families is named by its primary anchor ("Sync
  processor" is sync-family even though it moves events).
- A term enters the Language layer before specs may use it.

### Other relations

- **Derivation chain:** Event definition → Event → Eventlog → Materializer →
  State → Live query → App.
- **Containment:** A Client contains one or more Client sessions plus the
  Leader role; sessions reach the leader through a proxy.
- **Pluggable dimensions:** Adapter, Sync provider, Framework integration,
  State realization, Devtools surface — each is a contract with multiple
  realizations.
