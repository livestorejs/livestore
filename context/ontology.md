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
- **Rebase generation** — The component of an event sequence number that
  increments each time pending events are rebased; the leader rejects pushes
  carrying an older generation.
- **Pending event** — An event committed locally but not yet confirmed by
  the sync backend.
- **Upstream head** — The latest backend-confirmed eventlog position
  (persisted leader-side as `backendHead`).
- **Local head** — The latest locally committed eventlog position, including
  pending events.
- **Derived event** — A framework-generated event with an implicit
  materializer (e.g. client-document set events); never user-defined.
- **Schema hash** — The hash of the state-schema AST and event definitions
  that drives drift detection and state rebuild.
- **Storage format version** — The manually bumped version of persisted
  eventlog/state formats (`liveStoreStorageFormatVersion`); incompatible
  bumps reset persistence.
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
- **Query definition** — The hash-keyed blueprint of a live query; equal
  definitions share one query instance.
- **Query instance** — A live, reference-counted node in the reactivity
  graph, created from a query definition.
- **Result cache** — The bounded SQL-result cache keyed by statement and
  bind values, invalidated per written table; distinct from query-instance
  dedup.
- **Reactivity graph** — The incremental computation graph that propagates
  state changes to live queries.
- **Store registry** — The `storeId`-keyed manager of store lifecycles:
  load, reuse, eviction.
- **Fast path** — The session-boot shortcut that reads the persisted state
  DB directly instead of requesting a snapshot from the leader.
- **Boot status** — The staged boot progress surface
  (loading → migrating → rehydrating → syncing → done).
- **Termination lock** — A steal-mode Web Lock held by the shared worker;
  its release signals worker death.
- **Mesh node** — A named participant in the webmesh transport, connected to
  peers by edges and communicating over channels.
- **Direct channel** — A webmesh channel over a negotiated `MessagePort`;
  no per-message acknowledgements.
- **Proxy channel** — A hop-routed webmesh channel in which every payload is
  individually acknowledged.
- **Broadcast channel** — A fan-out webmesh channel without
  acknowledgements or buffering for late joiners.
- **Devtools** — The tooling surface for inspecting eventlog, state, and sync
  status, connected via the devtools protocol.
- **Devtools protocol version** — The integer handshake version that decides
  devtools compatibility; the package version is display-only.
- **SessionInfo** — The periodic identity announcement devtools use to
  discover live client sessions.
- **Introspection surface** — Devtools' direct inspection surface (debug
  info, graph snapshots), parallel to and currently independent of OTel
  telemetry. _Avoid:_ introspection channel (not a webmesh channel).
- **Control operation** — A devtools message that mutates engine state
  (reset, import, event injection) rather than inspecting it.
- **Application definition** — A Scenario dependency wrapping a real
  `LiveStoreSchema` together with named actions and optional normalized State
  inspectors; it never redeclares the Application's materializers.
- **Scenario specification** — A versioned, serializable description of a
  Scenario's topology, execution requirements, plans, Workload patterns,
  faults, completion, and Scenario oracles.
- **Scenario participant** — A Client or Client session instantiated and
  managed by a Scenario runner. A Leader is a role within a Client, and a Sync
  backend is a separate topology component.
- **Participant host** — A transport-neutral execution-profile realization
  that creates and controls Scenario participants behind serializable control
  and Scenario trace boundaries.
- **Participant execution profile** — The environment and isolation model in
  which Scenario participants run, such as in-process, worker/process, or
  browser.
- **Sync-backend realization** — A Scenario-side realization of the backend
  boundary, such as mock/in-memory, local concrete, or deployed.
- **Execution configuration** — The composition of a Participant execution
  profile, Sync-backend realization, and optional State capabilities for one
  Scenario run.
- **Workload pattern** — A named, parameterized, seeded generator of
  Application actions assigned to Scenario participants.
- **Scenario operation** — A runner-invoked interaction identified across its
  instruction, Participant-host response, related observations, and Operation
  outcome.
- **Control acknowledgement** — Evidence that a Participant host completed
  handling a controller request at its advertised boundary. It is neither Sync
  backend confirmation nor proof of propagation.
- **Participant-host failure** — A portable failure category at the
  Participant-host boundary: host infrastructure failure, request rejection,
  invalid response, response timeout, or transport failure. Category is
  independent from definite or indefinite Operation outcome certainty.
- **Operation outcome** — The controller's classification of a Scenario
  operation as successful, definitely failed, or indefinite. An indefinite
  outcome means the completion boundary was lost; it does not prove that the
  requested effect did not occur.
- **Scenario operation history** — A projection of Scenario operation
  invocations and outcomes for history-based checks. It is complete only for
  the operation families and invocation/completion boundaries retained by the
  Scenario trace.
- **Scenario fault model** — The supported adverse connectivity, availability,
  latency, lifecycle, or capacity conditions and assumptions of an Execution
  configuration.
- **Fault injection** — A Scenario operation that introduces a condition from
  the Scenario fault model.
- **Fault removal** — A Scenario operation that stops an injected condition.
  It does not itself prove Recovery.
- **Recovery** — Observed progression after Fault removal toward the required
  operating or converged state.
- **Quiescence** — No new Scenario workload and no relevant in-flight
  runner-controlled work; background streams and future polling may remain.
- **Convergence** — The required participants reach a declared agreement
  condition under the Scenario's stated assumptions.
- **Convergence group** — The Scenario participants that a settle phase
  requires to reach the same authoritative Eventlog and, when requested,
  equivalent normalized State.
- **Settlement barrier** — A profile-appropriate, bounded confirmation that
  the selected Convergence predicates form a stable fixed point after required
  Quiescence and Fault removal. It does not include Scenario property verdicts.
- **Scenario runner** — The headless orchestrator that validates a Scenario
  specification, controls participants and faults, and emits a Scenario trace.
  _Avoid:_ Scenario runtime (conflicts with LiveStore's Runtime).
- **Scenario trace** — A versioned semantic stream of Scenario instructions,
  Control acknowledgements, Operation outcomes, observations, and verdicts.
  OTel spans and other implementation details are namespaced diagnostic
  extensions. Its canonical ordering evidence is a causal partial order;
  runner receipt order and timestamps remain separately inspectable facts.
- **Scenario observation capture** — One runner-initiated collection of
  component observations. It groups facts sampled during the same collection
  pass but is neither an atomic distributed snapshot nor proof that the
  observed transitions happened simultaneously.
- **Scenario correlation** — Association of evidence belonging to the same
  Scenario operation or investigation. Correlation alone establishes neither
  direction nor causation.
- **Scenario dependency** — An evidence-supported ordering relationship
  between Scenario trace records.
- **Scenario causal order** — The partial order supported by
  Participant-local sequence and explicit Scenario dependency or causation
  edges. Correlation, timestamps, and Observation-capture membership alone
  never create an edge.
- **Calibrated Scenario time** — An estimated shared monotonic elapsed-time
  interval derived from a participant's local monotonic clock and a recorded
  clock calibration. Its uncertainty is part of the estimate; it measures
  latency but never establishes LiveStore sync causality.
- **Scenario property** — A declared correctness or reliability claim under
  stated Scenario assumptions.
- **Scenario oracle** — The mechanism that evaluates a Scenario property from
  bounded Scenario trace, observation, and State evidence.
- **Scenario verdict** — A Scenario oracle's result for one Scenario property,
  including its evidence references and explanation.
- **Scenario run artifact** — The reproduction bundle containing the
  normalized Scenario specification, source and Application identity,
  Execution configuration, seed, Scenario trace, snapshots, and verdicts.
- **Changeset (SQLite session)** — A SQLite session-extension changeset
  recorded per materialization, used to roll back state during rebase.
- **Changeset (release)** — A pnpm changeset file describing a package-level
  change, folded into release notes.
- **BDFL** — Benevolent Dictator For Life: the project creator holds final
  decision authority; governance detail in `05-contributing/`.
- **Facts** _(experimental)_ — Declarative constraints an event sets,
  unsets, requires, or reads; input to ordering, compaction, and conflict
  detection.
## Structure

The **event** is the spine: every other concept produces events, orders
them, derives from them, or observes the result.

| Relation to the spine | Terms |
| --- | --- |
| Produce | Store (commit), Client session |
| Order | Eventlog, Event sequence number, Sync backend, Rebase, Facts _(experimental)_ |
| Derive | Materializer, State, Client document |
| Observe | Live query, Reactivity graph, Devtools |
| Verify | Scenario specification, Scenario runner, Scenario trace, Scenario property, Scenario oracle, Scenario verdict |

### Term families and leitwörter

Families group terms around an anchor; followers carry the anchor's leitwort
in their name:

- **Event family** (leitwort "event") — anchor **Event**; followers Event
  definition, Eventlog, Event sequence number, Synced event, Client-only
  event, Pending event, Derived event.
- **Client family** (leitwort "client") — anchor **Client**; followers
  Client session, Client document.
- **Sync family** (leitwort "sync") — no single anchor noun; Sync provider,
  Sync backend, Sync processor share the leitwort. Rebase, Rebase
  generation, Upstream head, and Local head are its operation/position
  vocabulary (no leitwort — they name acts and places, not sync parts).
- **State family** — anchor **State**; Materializer, Changeset (SQLite
  session), Schema hash, and Storage format version are its derivation and
  versioning vocabulary (mechanism names, no shared leitwort).
- **Store family** (leitwort "store") — anchor **Store**; followers storeId,
  Store registry. Live query, Query definition, Query instance, Result
  cache, and Reactivity graph are its observation vocabulary.
- **Channel family** (leitwort "channel") — webmesh transport channels:
  Direct channel, Proxy channel, Broadcast channel; Mesh node is the
  participant term.
- **Devtools family** (leitwort "devtools") — anchor **Devtools**; follower
  Devtools protocol version. SessionInfo, Introspection surface, and
  Control operation are its discovery/inspection vocabulary.
- **Scenario family** (leitwort "Scenario") — anchor **Scenario
  specification**; followers Scenario participant, Scenario runner, Scenario
  operation, Scenario operation history, Scenario trace, Scenario observation
  capture, Scenario correlation, Scenario dependency, Scenario causal order,
  Scenario property, Scenario oracle, Scenario verdict, and Scenario run
  artifact. Application definition, Participant host, Participant execution
  profile, Execution configuration, Workload pattern, Scenario fault model,
  Fault injection, Fault removal, Recovery, Quiescence, Convergence,
  Convergence group, Settlement barrier, Control acknowledgement,
  Participant-host failure, Operation outcome, and Calibrated Scenario time are
  its execution and evidence vocabulary.

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
- **Scenario topology:** A Scenario runner controls Client and Client-session
  participants through a Participant host; a Sync backend remains a separate
  topology component selected through a Sync-backend realization.
- **Pluggable dimensions:** Adapter, Sync provider, Framework integration,
  State realization, Devtools surface — each is a contract with multiple
  realizations.
