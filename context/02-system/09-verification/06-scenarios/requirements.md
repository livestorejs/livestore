# Scenario-Based Sync Verification — Requirements

Role: owns the mechanism-independent contract for reproducible, system-wide
verification scenarios spanning Clients, Client sessions, Sync backends,
workloads, faults, Recovery, State, and runtime boundaries.

## Context

Builds on [../requirements.md](../requirements.md). Product behavior remains
owned by sync, runtime, State, Store, and observability nodes; this node owns
the evidence architecture that composes those behaviors. Runner, host, backend,
artifact, and viewer implementation intent live in `livestore-contrib` per
[decision 0003](./.decisions/0003-contrib-runner-viewer-realization.md).

## Requirements

- **LS.SYS.VER.SCEN-R01 Declarative scenario model:** Contributors author
  typed TypeScript Scenario specifications through Effect Schema-backed
  declarative constructors that normalize to a versioned, serializable AST.
  Control flow, time, randomness, faults, and assertions are explicit data,
  not arbitrary orchestration callbacks. Stable names, schema validation, and
  canonical serialization keep human- and agent-authored scenarios reviewable.
  `refines: LS-R11, LS.SYS-R02`
- **LS.SYS.VER.SCEN-R02 Application definition:** An Application definition
  wraps the actual `LiveStoreSchema` and reuses its Event types, Store type,
  and materializers. Named actions and State inspectors cross a host boundary
  by stable name and schema-encoded values; Scenario specifications never
  redeclare or invoke materializers. `refines: LS-R11`
- **LS.SYS.VER.SCEN-R03 Topology and lifecycle:** The Scenario model represents
  a Sync backend separately from one or more Clients. A Client is the stable
  top-level participant containing one active Leader role and one or more
  Client-session participants. Plans may create Clients, add Client sessions,
  and stop or restart supported session or Client runtimes while preserving
  their Scenario identities. `refines: LS.SYS-R04`
- **LS.SYS.VER.SCEN-R04 Explicit plans and workloads:** Plans declaratively
  compose application actions, participant lifecycle, connectivity and faults,
  workloads, scheduling, observed conditions, phases, and Settlement. Reusable
  Workload patterns expand deterministically, and every emitted application
  action appears in the Scenario trace.
- **LS.SYS.VER.SCEN-R05 Participant-host boundary:** The Scenario runner
  controls Clients and Client sessions only through a transport-neutral
  Participant-host contract. Scenario operations, Control acknowledgements,
  capability descriptions, application actions, Operation outcomes, and trace
  records crossing that boundary are serializable. An acknowledgement proves
  only completion of host handling at its advertised boundary, never Sync
  backend acceptance or propagation; the runner never holds participant
  Stores, processors, adapters, or databases.
- **LS.SYS.VER.SCEN-R06 Capability-based execution:** An Execution
  configuration composes a Participant execution profile, Sync-backend
  realization, and optional State capabilities. Profiles advertise supported
  controls and fault semantics before execution, and the runner rejects a
  Scenario whose required capabilities are unavailable. The contract does not
  require every profile/backend combination.
- **LS.SYS.VER.SCEN-R07 Production-shaped evidence:** A profile claiming
  composed-system correctness uses real Stores, session and Leader sync
  processors, materializers, and the selected State realization behind
  controlled boundaries. A processor-only model or runner-side simulation of
  product state cannot satisfy that claim. `refines: LS-R03, LS-R05, LS-R06`
- **LS.SYS.VER.SCEN-R08 Profile conformance and evidence scope:** Every
  Participant execution profile passes one shared host-conformance suite for
  its claimed capabilities. Compatible Scenarios remain unchanged across
  profiles, but each result makes claims only about its selected profile.
  Cross-profile comparison is optional and declares the properties compared.
- **LS.SYS.VER.SCEN-R09 Reproduction:** Every profile records a seed governing
  generated inputs and requested choices. Seeded reproduction never claims to
  reproduce internal delivery ordering. A profile may advertise recorded
  boundary replay only when it names and controls those boundaries, records
  their decisions, and reports the first replay divergence.
- **LS.SYS.VER.SCEN-R10 Time semantics:** Logical time orders Scenario-owned
  plan and trace facts and governs explicitly advertised runner-owned
  scheduling controls; performance evidence uses wall-clock time. Logical time
  is never reported as performance evidence or as proof of internal sync order.
- **LS.SYS.VER.SCEN-R11 Valid fault semantics:** Fault injection occurs at the
  highest boundary that still exercises the behavior under test and respects
  the selected realization's guarantees. Impossible corruption, duplication,
  or reordering requires an explicitly adversarial realization or capability.
  Fault removal ends the injected condition but does not itself prove Recovery;
  Recovery and Convergence require separate observation.
- **LS.SYS.VER.SCEN-R12 Sync/State separation:** Eventlog safety and
  Convergence are independently verifiable from State convergence and
  rematerialization. A State realization may be required by a full-stack
  profile without becoming part of Scenario-level sync semantics.
  `refines: LS-R05, LS-R06, LS-R10`
- **LS.SYS.VER.SCEN-R13 Scenario trace protocol:** Every run emits a versioned
  Scenario trace with a stable run descriptor, runner-receipt-ordered semantic
  records, distinct causal partial-order evidence, participant and boundary
  identities, correlation, explicit dependency/causation edges, and typed
  payloads. Correlation associates evidence but never establishes ordering or
  causation. Namespaced implementation diagnostics may extend the trace, but
  portable consumers ignore unknown diagnostics and do not depend on them.
- **LS.SYS.VER.SCEN-R14 Scenario properties and oracles:** Safety, ordering,
  Convergence, pending resolution, rebase preservation, State,
  rematerialization, liveness, and optional resource/performance claims are
  explicit Scenario properties. Scenario oracles evaluate them and produce
  bounded Scenario verdicts with evidence references. `refines: LS-R03, LS-R05`
- **LS.SYS.VER.SCEN-R15 Settlement:** A settle phase stops new work, removes
  its named faults, identifies the expected Convergence group, and evaluates
  an explicit profile-appropriate Settlement barrier and timeout. Unresolved
  pending Events or unacknowledged control work prevent successful Settlement;
  there is no hidden global meaning of “eventually.” Oracle evaluation follows
  Settlement and cannot retroactively change whether its barrier completed.
- **LS.SYS.VER.SCEN-R16 Reproducible artifacts:** A Scenario run artifact
  contains the normalized Scenario specification, Application and source
  identity, Execution configuration, component versions, seed, controlled
  decisions when present, Scenario trace, verdicts, and relevant snapshots
  needed to explain or replay the run.
- **LS.SYS.VER.SCEN-R17 Headless authority:** Headless execution is the
  authoritative local and CI mode. Live and replay visualization consume the
  Scenario trace or run artifact and may issue controls only through an
  explicit runner API; visualizers never mutate or inspect participants
  directly. `refines: LS-R13`
- **LS.SYS.VER.SCEN-R18 Cross-repository realization boundary:** Core owns
  this contract, its terminology, and generalized product testing seams.
  Scenario orchestration, hosts, backend realizations, traces, oracles,
  artifacts, corpus, and visualization are one contrib-owned realization and
  implementation-intent node. That realization may depend on core packages;
  core product packages never depend on it.
- **LS.SYS.VER.SCEN-R19 Causal and temporal evidence:** A Scenario trace
  preserves participant-local sequence, explicit control and boundary
  causation, runner receipt order, Observation-capture membership, and
  calibrated monotonic elapsed-time evidence as distinct facts. Cross-process
  time carries calibration uncertainty and never creates a causal edge or
  affects LiveStore sync behavior. Records distinguish an instrumented
  transition from a fact first observed by later sampling.
- **LS.SYS.VER.SCEN-R20 Truth-preserving trace projections:** Visualization
  offers causal-flow and elapsed-time projections over the same immutable
  trace. Flow layout exposes partial-order structure without claiming sibling
  transitions were simultaneous; elapsed-time layout exposes stalls and
  uncertainty without claiming timestamp order is causality. Aggregation,
  visibility filters, and derived playback navigation never remove access to
  raw records or change observation-index cursor semantics.
  `refines: LS.SYS.VER.SCEN-R13, LS.SYS.VER.SCEN-R17`
- **LS.SYS.VER.SCEN-R21 Operation outcomes and history:** Runner-invoked
  Scenario operations preserve stable identity and classify their outcome as
  success, definite failure, or indefinite whenever the execution boundary
  supplies that knowledge. Timeouts and lost responses never imply that an
  operation did not occur. Participant-host failure category is independent
  from outcome certainty. A Scenario operation history advertises which
  operation families and concurrency boundaries it covers; the full Scenario
  trace remains the authoritative evidence envelope.
