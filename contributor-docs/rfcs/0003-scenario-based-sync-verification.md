# Scenario-Based Sync Verification

> **Status: draft.**

## Context

LiveStore synchronizes one ordered event history across clients through two
boundaries:

```text
+-------------------------------- Client --------------------------------+
|                                                                        |
|  +----------------+      local push       +----------------+           |
|  | Client session | --------------------> |     Leader     |           |
|  |                | <-------------------- |                |           |
|  +----------------+    advance / rebase   +----------------+           |
|                                                |       ^               |
+------------------------------------------------|-------|---------------+
                                                 | push  | pull stream
                                                 v       |
                                          +------------------+
                                          |   Sync backend   |
                                          +------------------+
```

The same `SyncState` merge model governs both boundaries. The client-session
and leader sync processors add the queues, batching, retry, cursor tracking,
materialization, and rebase critical sections that drive the model in the
running system. The sync backend is the central ordering authority.

The current verification architecture has separate unit, package-integration,
browser-integration, sync-provider, SQLite-substrate, and performance lanes.
It also has several targeted simulation facilities:

- [`ClientSessionSyncProcessor`](../../packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts)
  exposes timing controls around selected rebase steps.
- [`mock-sync-backend.ts`](../../packages/@livestore/common/src/sync/mock-sync-backend.ts)
  supports connection changes and controlled pull/push failures.
- Processor tests manually construct individual concurrency and recovery
  sequences.
- The performance suites collect latency and memory measurements in browser
  applications.

These mechanisms verify specific cases, but they do not form a unified system
for defining a topology, generating activity, applying faults, running real
sync components, evaluating convergence, and explaining the result.

The current contracts are documented in the intent layer under
[`context/02-system/09-verification/`](../../context/02-system/09-verification/spec.md).
This RFC proposes new architecture and therefore remains the sole design
source until it is accepted and its durable contracts are folded into that
intent layer. Missing implementation is then tracked explicitly as intent-layer
deltas.

## Problem

LiveStore lacks a reproducible way to verify the complete sync system under
long-running, concurrent, and adverse conditions.

Today, a difficult sync case is usually encoded directly in one test. The test
owns its setup, timing, fault injection, and assertions. That makes targeted
regression coverage possible, but it makes it difficult to:

- describe and review a scenario independently of its test harness;
- apply the same scenario to different runtime realizations;
- add and remove clients during a run;
- compose reusable workload and network-fault patterns;
- reproduce a failure caused by a particular interleaving;
- distinguish eventlog convergence from read-model convergence;
- inspect internal queues, batches, heads, retries, and rebases as one causal
  timeline;
- replay a failed headless run in a visual debugger; or
- reuse correctness scenarios for later throughput and performance analysis.

The primary concern is correctness: after allowed faults heal, accepted events
must not be silently lost or duplicated, and all participating clients must
eventually converge on the authoritative event order. Performance and
throughput are secondary concerns, but the architecture should not prevent the
same scenarios from measuring them later.

## Goals

The proposed system should:

1. Define scenarios as serializable, reviewable data rather than runner code.
2. Execute real LiveStore sync components instead of reimplementing their
   behavior in a model that can drift.
3. Run headlessly as the primary mode, with deterministic reproduction where
   practical.
4. Support dynamic participants, scripted actions, reusable workload patterns,
   and network or process faults.
5. Separate orchestration from visualization through a stable trace protocol.
6. Evaluate safety, convergence, and liveness through explicit oracles.
7. Preserve a path from lightweight in-process participants to worker,
   process, and browser participants, independently combinable with mock,
   local, or deployed sync backends.
8. Let agents construct and modify scenarios without generating large amounts
   of bespoke test code.
9. Keep the scenario model independent of a particular read-model
   implementation while exercising SQLite in the initial full-stack
   configuration.
10. Produce self-contained artifacts that explain and replay failures.

## Non-Goals

The first version does not need to:

- redesign LiveStore's sync protocol;
- implement the future separation of sync and read models;
- provide a finished dashboard before headless execution is useful;
- emulate packet-level network behavior;
- run every participant in a VM or container;
- support every production sync-provider realization;
- define performance budgets; or
- inject schema-invalid or wire-invalid events as a primary workflow.

Those capabilities may be added without changing the core scenario model.

## Proposed Solution

Build a scenario runner around a declarative scenario specification. The
runner creates the requested LiveStore participants, controls time and fault
conditions, executes the workload, and emits a normalized trace. Correctness
oracles, artifact storage, visualization, and performance analysis consume the
same trace.

```text
scenario source
      │
      ▼
scenario parser + validator
      │
      ▼
scenario runner ─────── controls ──────┬─ participants
      │                                ├─ network/fault model
      │                                └─ clock/scheduler
      │
      └──────────── normalized trace ──┬─ correctness oracles
                                       ├─ saved run artifact
                                       ├─ live/replay visualizer
                                       └─ performance analysis
```

The scenario semantics, runner, trace, and oracles are distinct contracts.
This allows the file format and visualization to evolve without changing the
meaning of a run.

The runner controls clients and sessions only through a transport-neutral
participant-host contract. Commands, acknowledgements, application actions,
faults, capability descriptions, and trace records crossing that contract must
be serializable. The first host implementation runs in-process and may use
direct Effect calls internally, but the runner must not depend on references to
a participant's `Store`, processors, adapter, or databases. A later browser or
process host can therefore carry the same control protocol over an RPC or
message transport without changing scenario semantics.

### Terminology

| Term | Meaning |
| --- | --- |
| **Application definition** | Executable module exporting the LiveStore event schema and, when enabled, materializers and state inspection helpers. |
| **Scenario specification** | Serializable description of participants, workloads, faults, schedule, execution options, and assertions. |
| **Participant** | A role instantiated by the runner: sync backend, client, leader, or client session. |
| **Participant host** | Execution-profile implementation that creates and controls clients and sessions behind the serializable runner-control and trace boundary. |
| **Participant execution profile** | How client-side roles run: in-process, worker/process, or browser. |
| **Sync-backend realization** | What the leader synchronizes with: a mock/in-memory backend, a locally running concrete backend, or a deployed backend. |
| **Execution configuration** | Combination of one participant execution profile, one sync-backend realization, and an optional state profile. |
| **Workload pattern** | Reusable generator of application actions assigned to one or more clients. |
| **Fault model** | Controlled changes to connectivity, availability, latency, process lifetime, or capacity. |
| **Convergence group** | Participants that a settle phase requires to reach the same authoritative eventlog and, when requested, equivalent state. |
| **Settlement barrier** | Profile-appropriate confirmation that convergence predicates form a stable fixed point even if background streams or future polling remain active. |
| **Trace** | Ordered stream of scenario actions and observed system transitions. |
| **Oracle** | Executable rule that turns observed state and trace data into a verdict. |
| **Run artifact** | Scenario, seed, execution configuration, trace, measurements, snapshots, and oracle results needed to inspect or reproduce one run. |

“Scenario runner” is used instead of “scenario runtime” to avoid confusing the
orchestrator with LiveStore's own runtime architecture.

### Scenario Semantic Model

The first version should use one scenario file. It may reference executable
application definitions and named workload libraries, but all run-specific
configuration should remain visible in that file.

The scenario specification must be able to express:

| Area | Required information |
| --- | --- |
| Identity | Stable scenario name, description, format version, and tags. |
| Reproduction | Random seed, scheduling mode, and execution configuration. |
| Application | Reference to an application definition containing the event schema and optional materializers. |
| Topology | Sync backend, clients, client sessions, links, and initial connectivity. |
| Lifecycle | Participants present at start and participants added, restarted, or removed later. |
| Workloads | Explicit actions and reusable parameterized activity patterns assigned to clients. |
| Schedule | Actions triggered by logical time, prior actions, observed conditions, or phase boundaries. |
| Faults | Backend outages, partitions, latency, constrained throughput, process death, and recovery. |
| Completion | Duration, convergence group, settlement barrier and timeout, phase completion, or explicit terminal action. |
| Assertions | Safety, convergence, liveness, state, and optional performance oracles. |
| Capture | Trace detail, state snapshots, and measurement options. |

This RFC intentionally defines the semantic model before selecting YAML,
JSON, TOML, or another concrete syntax. A concrete grammar is useful only
after the concepts and their composition rules are stable.

### Application and Event Schemas

“Application schema” and “scenario format schema” are separate concepts:

- The **application schema** defines the actual LiveStore events accepted by
  the clients and, for full-stack runs, their materializers.
- The **scenario format schema** validates the serialized scenario document.

The scenario should reference an executable TypeScript application definition
rather than attempt to reproduce arbitrary Effect Schema definitions in a text
format. That module can expose:

- the LiveStore schema;
- named event constructors or higher-level application actions;
- optional materializers and read-model inspection;
- value generators used by workload patterns; and
- canonical state normalization or hashing for convergence checks.

Scenario actions are named, serializable commands validated against the
referenced application definition before execution. The participant host loads
that definition and dispatches each command through the real `Store` API in the
target session. The runner never calls a participant's `Store` directly. This
keeps the same application-action protocol usable when the target moves from
the in-process host to a worker, process, or browser host. Deliberately invalid
application events or malformed wire payloads should require an explicit
adversarial mode so normal scenarios do not accidentally test behavior outside
the protocol contract.

### Topology Model

The initial topology should represent the actual two-boundary LiveStore
system, not an arbitrary peer-to-peer graph:

```text
sync backend
    ▲
    │ provider boundary
    │
client
  └─ leader
       ▲
       │ leader-proxy boundary
       ├─ client session A
       └─ client session B
```

A scenario may define several clients sharing one backend. Each client owns a
leader and one or more sessions. Version one may instantiate one session per
client while retaining the distinction in the semantic model.

After a scenario has started, the runner must be able to add a new client or
add another client session to an existing client. It must also be able to
restart or remove an existing participant. This is necessary to test initial
sync, multi-session behavior, recovery, leadership handover, and convergence
after long offline periods.

### Execution Configuration

Client execution and sync-backend integration are orthogonal decisions. A
scenario selects a participant execution profile and a sync-backend
realization independently. For example, browser clients can use the mock
backend, while in-process clients can connect to a deployed backend.

#### Participant-Host Boundary

Every participant execution profile implements the same logical host contract.
The exact TypeScript API remains an implementation decision, but the contract
must support:

- creating a client and adding a session to an existing client;
- executing a named, serialized application action in a target session;
- stopping and restarting a session, client, or leader where supported;
- applying and healing faults exposed by the selected profile;
- acknowledging lifecycle and control operations;
- advertising profile capabilities before a run starts; and
- emitting the normalized trace without exposing participant implementation
  objects to the runner.

Participants and control operations use stable scenario-level identifiers.
Scenarios declare the capabilities they require, and the runner rejects an
execution configuration that cannot provide them. This allows portable
scenarios to use the common capability set while browser- or process-specific
scenarios explicitly request platform behavior such as Web Locks, OPFS, or
actual process termination.

The existing LiveStore `Adapter` remains below this boundary: an adapter creates
one client session for a platform, while a participant host orchestrates a
dynamic collection of clients and sessions and exposes scenario lifecycle,
fault, and observation controls. The host may use different adapters in
different execution profiles.

#### Participant Execution Profiles

| Profile | Intended use | Fidelity and cost |
| --- | --- | --- |
| **In-process** | Default correctness, generative, and stress exploration. | Real Stores, client-session and leader processors, materializers, and SQLite databases behind in-memory boundaries; highest determinism and density. |
| **Worker/process** | Process-boundary, lifecycle, and crash behavior. | Real isolation with moderate startup and coordination cost. |
| **Browser** | Web adapter, OPFS, Web Locks, worker topology, and browser lifecycle. | High fidelity and cost; fewer participants. |

#### Sync-Backend Realizations

| Realization | Intended use | Fidelity and cost |
| --- | --- | --- |
| **Mock/in-memory** | Deterministic correctness, controlled failures, and high participant counts. | No real transport, deployment platform, authentication, or backend persistence. |
| **Local concrete backend** | Exercise a real provider client and backend implementation in a local development environment. | Covers serialization, chunking, pagination, streaming/polling, persistence, and reconnection without remote deployment dependence. |
| **Deployed sync backend** | End-to-end verification against an actual deployed backend. | Adds real authentication, networking, backend persistence, platform limits, and deployment behavior; highest environmental dependence. |

The deployed-backend realization is what this RFC previously called “provider
integration.” It concerns the leader-to-backend boundary, not where the client
runs. A browser profile and deployed-backend realization together form the
highest-fidelity end-to-end configuration, but either can be selected without
the other.

The first authoritative configuration is a production-shaped in-process host.
Each client has one actual leader and one or more actual client sessions. Each
session owns a real `Store`, `ClientSessionSyncProcessor`, and in-memory SQLite
state database; the sessions share the client's real `LeaderSyncProcessor`,
eventlog database, and leader state database through an in-memory leader proxy.
Multiple clients share the selected mock/in-memory sync backend. This exercises
the current production-shaped critical sections without requiring one OS
process or browser per client.

Direct processor-only harnesses may remain useful as a subordinate testing
profile, but they do not satisfy the authoritative in-process scenario profile
by themselves because they bypass Store and participant lifecycle behavior.

Later participant profiles and backend realizations must preserve scenario
semantics and trace vocabulary. A scenario using capabilities shared by
several configurations should run unchanged across them.

#### Profile Conformance and Calibration

Every participant execution profile must pass one shared host-conformance suite
covering client and session creation, named action dispatch, lifecycle control,
capability rejection, stable participant identities, required core trace
records, fault/control failure reporting, and valid run artifacts.

A maintained calibration corpus then runs unchanged across the in-process and
browser profiles using only their shared capabilities. It covers at least
initial sync, single and concurrent writers, offline accumulation and reconnect,
backend outage and recovery, multiple sessions, participant restart, rebase
after remote progress, settlement, and state convergence.

Cross-profile calibration compares semantic outcomes rather than byte-identical
executions. The profiles must satisfy equivalent safety, pending-resolution,
convergence, and requested state oracles; preserve the same accepted event set;
and emit the required stable trace families. Timing, diagnostics, retry counts,
and exact trace order need not match. Exact eventlog order is compared only when
the scenario defines that order; genuinely concurrent runs may produce
different valid authoritative orders.

The browser profile is the platform-fidelity calibration target because it
exercises the web adapter, worker topology, Web Locks, OPFS, and browser
lifecycle. A worker/process profile helps isolate transport and lifecycle
differences but does not substitute for browser calibration.

The in-process profile may be delivered and used before the browser host exists.
Until browser calibration is available, its artifacts identify the evidence as
in-process and do not claim browser-platform fidelity. Adding the browser host
must not require changing the portable scenario corpus or oracle semantics.

### Time and Scheduling

Correctness runs and performance runs need different notions of time:

- **Logical/virtual time** is the default for deterministic correctness runs.
  The runner controls timers, scheduled faults, workload rates, and relevant
  runner-owned delivery delays.
- **Wall-clock time** is required for throughput, latency, CPU, and memory
  measurements.

Every generated choice must derive from a recorded seed. Seeded reproduction is
the minimum guarantee for every execution profile: it recreates application
actions, generated values, workload parameters, requested timings, and fault
choices, but does not by itself promise the same host interleaving.

The authoritative in-process correctness profile must additionally support
controlled boundary record/replay. The runner records the order in which it:

- dispatches scenario actions and lifecycle operations;
- activates and heals faults;
- releases mock-backend responses;
- releases controlled session-to-leader and leader-to-backend deliveries; and
- advances runner-owned logical time.

A recorded replay gates those boundaries according to the captured decision
sequence. If the next recorded operation cannot become available or its
preconditions differ, the runner reports the decision at which replay diverged;
it must not silently claim to have reproduced the execution. Exact Effect fiber
scheduling, browser event-loop scheduling, remote-backend ordering, and
byte-identical trace reproduction are not part of the guarantee.

Execution profiles advertise `logical-time`, boundary-recording, and
boundary-replay capabilities independently. Worker, browser, and deployed
backend configurations always preserve the seed and detailed observed trace but
only promise stronger scheduling control when their capabilities provide it.
Wall-clock performance runs reproduce workload inputs and environment metadata,
not logical scheduling.

The schedule should support:

- actions at a logical timestamp;
- actions after another named action;
- phases with setup, activity, fault, recovery, and settle periods;
- actions triggered by observable conditions such as a head, queue depth, or
  connection state; and
- a bounded wait for quiescence or convergence.

Logical time must not be reported as performance evidence.

### Workload Patterns

Scenarios need both precise scripts and generated activity:

- **Explicit actions** describe small regression cases with exact ordering.
- **Named patterns** describe repeated or high-volume behavior such as steady
  writers, bursts, skewed writers, hot entities, offline accumulation, or
  reconnect storms.
- **Seeded generators** explore event values and interleavings while remaining
  reproducible.

A workload pattern declares its compatible application actions, parameters,
rate or count, target clients, and stopping condition. Patterns should compose
without requiring the scenario author to enumerate thousands of events.

This is also the primary agent-authoring surface: agents can choose named
patterns, parameters, faults, and seeds from a validated vocabulary rather
than generate bespoke runner code.

### Network and Fault Model

Fault injection should occur at the highest boundary that still exercises the
behavior under test. The default model must respect the guarantees of the
selected sync-backend realization.

Initial faults should include:

- client-to-backend disconnect and reconnect;
- backend unavailability and recovery;
- delayed pull or push responses;
- bounded latency and jitter;
- constrained throughput and resulting queue growth;
- client, session, or leader termination and restart; and
- stale-head and concurrent-push conditions produced through valid protocol
  behavior.

Message corruption, duplication, or arbitrary reordering should only be
available when the selected transport can exhibit them or when an explicit
adversarial backend realization is requested. Otherwise the harness risks
finding failures in impossible systems.

### Read Models and SQLite

Sync correctness and materialized-state correctness are related but distinct:

1. **Sync correctness:** clients converge on the authoritative eventlog order,
   with no silent event loss or duplication.
2. **Full-stack correctness:** after eventlog convergence, the clients'
   materialized state also converges and can be reproduced from that eventlog.

The scenario model does not define SQLite as part of sync semantics. It selects
state capabilities supplied by the application definition and execution
configuration. Eventlog convergence is available independently of state
assertions; state convergence and rematerialization are optional oracle
families that require compatible state-inspection capabilities.

The first authoritative in-process profile requires SQLite materialization for
every participant because the current processors integrate it into important
behavior:

- session rebases roll back SQLite changesets;
- leader pulls and local pushes materialize batches;
- leader state and eventlog transactions are coordinated; and
- materializer failures can terminate the runtime.

Version one does not add an eventlog-only participant profile. Such a profile
would isolate the sync protocol, but implementing it before the planned
sync/state separation may create a test-only seam that does not represent the
running product. The participant-host and scenario boundaries must permit an
eventlog-only or alternative-state profile later without requiring a new
scenario language. A scenario that requests state-specific capabilities is
rejected by a profile that cannot provide them; a sync-only scenario can run
unchanged.

### Trace Protocol

The runner emits one normalized trace for live observation and replay. The
visualizer never needs private access to participant internals outside this
contract. The trace is a versioned verification-artifact protocol, not a
promise that all diagnostic details become permanent public LiveStore APIs.

A stable run descriptor records metadata that applies to the whole stream once:

- trace-protocol and scenario-format versions;
- scenario and run identifiers;
- source revision and application-definition identity;
- execution configuration, component versions, and advertised capabilities;
  and
- seed and reproduction mode.

Every stable trace record then uses a small common envelope containing:

- run identifier and a monotonic runner-observation index;
- stable record kind and origin (`instruction`, `acknowledgement`,
  `observation`, or `verdict`);
- participant, role, and boundary identifiers where applicable;
- logical time and wall-clock time where the profile provides them;
- correlation and causation identifiers where applicable; and
- a typed, versioned payload for the record kind.

The observation index defines the order in which the runner received records;
it does not claim that distributed operations happened atomically in that
order. Correlation joins records belonging to one action, batch, request, or
fault, while causation records why a transition occurred.

The stable semantic record families cover:

- run and phase lifecycle;
- participant lifecycle and runner-control acknowledgements;
- named application actions and their results;
- connectivity and batches crossing session/leader or leader/backend
  boundaries;
- event disposition, including pending, confirmed, rejected, and terminally
  failed events;
- observed local, upstream, and backend positions;
- advance and rebase transitions with relevant event identities and
  generations;
- fault request, observed activation, and healing;
- settlement progress and barrier results;
- oracle verdicts and their evidence references; and
- structured failure classifications.

Implementation-specific observations are namespaced diagnostic extensions,
not stable core records. Initial examples include private queue and buffer
names, raw queue depths, Effect scheduler state, SQLite statements and
changesets, detailed materializer execution, provider-specific payloads, Web
Lock and OPFS internals, raw OTel spans, stack traces, and performance entries.
Core consumers ignore unknown diagnostic records. Portable correctness oracles
must not depend on a diagnostic extension unless the scenario explicitly
requires a capability that provides it. A diagnostic concept may be promoted
to the stable core when several profiles and portable consumers need the same
semantic meaning.

Additive optional core fields do not require a new major trace-protocol version;
removing a field or changing its meaning does. Saved artifacts retain their
original version, and large payloads may be stored as referenced artifact blobs
rather than embedded in every record.

The trace must distinguish a scenario instruction (“disconnect client A”) from
an observation (“client A reported offline”). This preserves causality and
lets the runner detect when a requested fault did not take effect.

### Correctness Oracles

Oracles are first-class scenario configuration, not assertions hidden inside
runner code.

| Oracle family | Example property |
| --- | --- |
| Safety | No accepted event disappears or appears more than once in the authoritative history. |
| Ordering | Every confirmed client eventlog is a prefix of, and eventually equal to, the backend order. |
| Convergence | After faults heal and workloads stop, all connected clients reach the same eventlog head within a bounded condition. |
| Pending resolution | Pending events become confirmed or produce an explicit terminal failure; they are not silently abandoned. |
| Rebase preservation | Rebase changes ancestry/order as specified without losing the relevant local events. |
| State convergence | Enabled clients produce equivalent normalized state from the converged eventlog. |
| Rematerialization | Rebuilding from the authoritative eventlog yields the same normalized state. |
| Liveness | The system reaches quiescence or a declared steady state after recovery. |
| Resource bound | Queues, retries, convergence delay, or memory stay within a scenario-specific bound. |

Safety failures should terminate or freeze the run promptly while preserving
artifacts. Liveness and convergence oracles require explicit assumptions about
which faults have healed and which participants are expected to remain online.

Performance thresholds are optional oracles in wall-clock profiles. A long
convergence delay may eventually be treated as a correctness failure, but the
scenario must state the applicable deadline rather than rely on a global
implicit timeout.

#### Settlement, Convergence, and Quiescence

Quiescence is a stable contract-level fixed point, not the absence of all
runtime activity. Live pull streams may stay open, polling may schedule future
work, and telemetry may continue after a run has converged.

A scenario enters a settle phase by:

1. stopping new workload actions and awaiting acknowledgement of actions
   already dispatched;
2. healing the faults named by the phase;
3. declaring the convergence group, including which intentionally removed or
   offline participants are excluded; and
4. stopping new writes from that group while the settlement barrier is being
   evaluated.

For an authoritative backend head `H`, convergence requires every expected
participant to hold the same authoritative event order through `H`, with no
unexplained pending events. Local and upstream heads must agree at `H`, and any
requested state-convergence or rematerialization oracle must also pass. The
runner must have no unacknowledged control operations or held, due controlled
delivery capable of changing the verdict.

An unresolved pending event prevents successful settlement. It must become
backend-confirmed, explicitly rejected, or reach a terminal failure that the
scenario permits. Expiry of the settlement timeout while an event remains
pending is a liveness failure.

The authoritative in-process profile confirms stability through an explicit
settlement barrier: it releases boundary work due under the selected schedule,
advances logical time until no immediately due controlled work can change the
verdict, observes every expected participant at `H`, confirms that the backend
head remains `H`, and re-evaluates the convergence predicates. Open streams and
future polling timers do not prevent success.

Profiles without a controlled settlement barrier may confirm stability through
repeated observations or a bounded wall-clock stability window. The profile
must advertise that weaker capability, and the run artifact records which
confirmation mechanism was used. Every settle phase has an explicit logical-
or wall-clock timeout; there is no hidden global meaning of “eventually.”

### Headless Runs and Visualization

Headless execution is the authoritative mode. It must be usable in focused
local tests, generative exploration, and CI without starting the dashboard.

The dashboard consumes either a live trace stream or a completed run artifact.
It should support two complementary views:

1. **System view:** backend, clients, sessions, connections, traffic, queue
   pressure, and current convergence state.
2. **Timeline view:** application events and internal transitions organized by
   participant and causal flow, with rebases, retries, and faults highlighted.

Selecting a participant should reveal its eventlog heads, pending suffix,
rebase generation, batches, queue depths, network state, and materialization
activity. The UI is an observer and replay surface; runner control should go
through an explicit control API rather than mutate participants directly.

### Run Artifacts and Reproduction

A failed or noteworthy run should produce a self-contained artifact containing:

- the normalized scenario specification;
- application-definition identity and component versions;
- execution configuration and environment metadata;
- seed, runner-control decisions, and any recorded boundary schedule;
- complete or policy-filtered trace;
- oracle results and failure explanation;
- relevant eventlog and state snapshots; and
- performance measurements when wall-clock mode is enabled.

The minimum reproduction command should need only the artifact and the matching
source revision. It supports seeded replay for every profile and recorded
boundary replay when the artifact and selected profile provide it. Automated
shrinking or minimization of a failing workload is desirable but can follow
reliable reproduction.

### Agent Authoring

The scenario format should be straightforward for both humans and agents:

- machine-readable schema with useful validation errors;
- stable names for participants, phases, patterns, faults, and oracles;
- references instead of duplicated application-schema definitions;
- reusable pattern catalog with documented parameters;
- deterministic seeds displayed in every result;
- defaults that produce valid protocol behavior; and
- a formatter or canonical serializer so generated diffs remain reviewable.

An agent should be able to answer “construct a three-client scenario where one
client writes offline, another writes in bursts, the backend becomes
unavailable, and all clients must converge after recovery” by composing
declared primitives rather than writing TypeScript orchestration code.

### Intent-Layer Ownership

On acceptance, the durable architecture in this RFC folds into a new
verification child:

```text
context/02-system/09-verification/
└── 06-scenarios/
    ├── intuition.md
    ├── requirements.md
    ├── spec.md
    └── .delta/
        └── DELTA-001-scenario-verification-not-built.md
```

The node is titled **Scenario-Based Sync Verification** and uses the
`LS.SYS.VER.SCEN-*` namespace. `06-scenarios` is preferred over
`06-simulation` because the authoritative profiles exercise real LiveStore
components rather than a separate behavioral model.

The scenarios node owns the scenario semantics, participant-host contract,
execution-profile and backend-realization composition, workloads, fault
semantics, reproduction guarantees, settlement, trace protocol, oracle
composition, artifacts, profile conformance, cross-profile calibration, and
runner/visualizer separation.

The existing verification children retain their current responsibilities:
lanes own invocation, conformance owns the general realization-independent
testing pattern, performance owns trustworthy performance evidence, and
determinism owns system determinism guards. The scenarios node composes those
evidence shapes for this architecture. Sync, runtime, state, and observability
remain owners of the product behavior being verified rather than acquiring
scenario-runner requirements.

The fold-in also registers the child and namespace in the verification parent
and root intent-layer structure, adds accepted scenario terminology to
`context/ontology.md`, and records architectural acceptance in
`context/.decisions/` with this RFC as evidence. The initial delta records that
the accepted runner and profiles are not yet implemented.

The remaining design questions become `LS.SYS.VER.SCEN-DQ*` questions in the
new node. After the fold-in, this RFC remains the historical proposal and is no
longer updated as the implementation evolves.

## Delivery Sequence

The architecture can be delivered incrementally:

1. **Semantic model:** settle participants, scheduling, workloads, faults,
   trace vocabulary, and oracle definitions; select the concrete file format.
2. **Headless in-process runner:** participant-host conformance suite,
   production-shaped in-process host, real sync processors, mock backend,
   SQLite, explicit actions, basic disconnect/reconnect faults, convergence
   oracles, portable calibration scenarios, and reproducible artifacts.
3. **Generated stress scenarios:** reusable workloads, seeded scheduling,
   conditional actions, richer faults, resource observations, and failure
   minimization.
4. **Visualization:** live trace transport, saved-run replay, system view,
   timeline view, and participant drill-down.
5. **Additional fidelity configurations:** worker/process and browser
   participant profiles, shared host-conformance runs, cross-profile calibration,
   local and deployed sync backends, and alternative state profiles when their
   product boundaries exist.
6. **Performance use:** wall-clock execution, comparable measurements, and
   scenario-specific budgets integrated with performance verification.

Each phase must preserve headless execution and the same scenario semantics.

## Alternatives Considered

### Test only the pure `SyncState` model

Pure model and property tests are fast and deterministic, and should remain
part of the strategy. Alone they do not exercise queues, batching, retries,
cursors, processor precedence, materialization, or runtime boundaries—the
areas where many difficult failures occur.

### Encode every scenario directly in TypeScript

This provides maximum freedom and immediate access to internal APIs. It also
makes scenarios difficult to inspect, generate, validate, replay, migrate, and
visualize uniformly. Executable application definitions and extension points
remain possible without making orchestration code the scenario format.

### Run every client in a browser or container

This maximizes some forms of fidelity but makes large, deterministic stress
runs slow and operationally expensive. High-fidelity configurations should
validate the same scenario semantics selectively; they should not be the
minimum unit of simulation.

### Couple the runner and dashboard

A UI-driven runner is attractive for exploration but prevents cheap CI runs
and makes failures harder to reproduce. A trace boundary supports both live UI
use and independent headless execution.

### Make SQLite mandatory in the scenario language

This matches the current implementation but would make the sync verification
model depend permanently on one read model. SQLite should be the initial
full-stack state profile, not part of the scenario's definition of sync.

### Omit materialization from the initial runner

This isolates ordering and convergence but skips production-shaped rollback,
transaction, and failure behavior. Until sync and read models are separated in
the product, the initial profile should exercise SQLite while reporting sync
and state oracles separately.

### Begin by fixing a complete YAML/JSON grammar

A concrete syntax makes examples tangible, but choosing it before settling
participants, scheduling, workload composition, faults, and oracle semantics
would encode accidental decisions. Define the semantic model first, then choose
and version the serialization.

## Open Questions

1. Which concrete scenario syntax best balances authoring, schema validation,
   comments, composition, and canonical formatting?
2. What is the smallest application-definition API that supports event
   construction, generated values, materialization, and state comparison?
3. At which abstraction should latency and partitions be injected for each
   combination of participant execution profile and sync-backend realization?
4. How should large traces be sampled, compressed, or streamed without losing
   the causal evidence needed to explain a failure?
5. When should invalid application events, malformed protocol payloads, and
   impossible transport behavior become supported adversarial modes?
6. How should failing generated scenarios be minimized while preserving the
    causal interleaving that triggered the failure?
7. Which correctness scenarios can also produce trustworthy performance
    evidence, and which require a separate wall-clock configuration?
