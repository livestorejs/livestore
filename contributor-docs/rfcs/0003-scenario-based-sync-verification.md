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
source until it is accepted, implemented, and folded into that intent layer.

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
7. Preserve a path from lightweight in-process runs to worker, process,
   browser, and real-provider execution profiles.
8. Let agents construct and modify scenarios without generating large amounts
   of bespoke test code.
9. Keep the scenario model independent of a particular read-model
   implementation while exercising SQLite in the initial full-stack profile.
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

### Terminology

| Term | Meaning |
| --- | --- |
| **Application definition** | Executable module exporting the LiveStore event schema and, when enabled, materializers and state inspection helpers. |
| **Scenario specification** | Serializable description of participants, workloads, faults, schedule, execution options, and assertions. |
| **Participant** | A role instantiated by the runner: sync backend, client, leader, or client session. |
| **Execution profile** | Mapping from participant roles to concrete in-process, worker, process, browser, or provider realizations. |
| **Workload pattern** | Reusable generator of application actions assigned to one or more clients. |
| **Fault model** | Controlled changes to connectivity, availability, latency, process lifetime, or capacity. |
| **Trace** | Ordered stream of scenario actions and observed system transitions. |
| **Oracle** | Executable rule that turns observed state and trace data into a verdict. |
| **Run artifact** | Scenario, seed, profile, trace, measurements, snapshots, and oracle results needed to inspect or reproduce one run. |

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
| Reproduction | Random seed, scheduling mode, and execution profile. |
| Application | Reference to an application definition containing the event schema and optional materializers. |
| Topology | Sync backend, clients, client sessions, links, and initial connectivity. |
| Lifecycle | Participants present at start and participants added, restarted, or removed later. |
| Workloads | Explicit actions and reusable parameterized activity patterns assigned to clients. |
| Schedule | Actions triggered by logical time, prior actions, observed conditions, or phase boundaries. |
| Faults | Backend outages, partitions, latency, constrained throughput, process death, and recovery. |
| Completion | Duration, quiescence condition, phase completion, or explicit terminal action. |
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

Scenario actions are validated against the referenced application definition
before execution. Deliberately invalid application events or malformed wire
payloads should require an explicit adversarial mode so normal scenarios do
not accidentally test behavior outside the protocol contract.

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

The runner must be able to add a client after the scenario has started and to
restart or remove an existing participant. This is necessary to test initial
sync, recovery, leadership handover, and convergence after long offline
periods.

### Execution Profiles

The decision between lightweight simulation and real browser/process
execution should be represented as profiles, not embedded into scenario
meaning.

| Profile | Intended use | Fidelity and cost |
| --- | --- | --- |
| **In-process** | Default correctness, generative, and stress exploration. | Real sync state and processors with controlled boundaries; highest determinism and density. |
| **Worker/process** | Process-boundary, lifecycle, and crash behavior. | Real isolation with moderate startup and coordination cost. |
| **Browser** | Web adapter, OPFS, Web Locks, worker topology, and browser lifecycle. | High fidelity and cost; fewer participants. |
| **Provider integration** | Concrete provider transport and deployment behavior. | Highest environmental dependence; focused conformance runs. |

The proposed first profile is in-process execution using the actual
`SyncState`, `ClientSessionSyncProcessor`, `LeaderSyncProcessor`, mock sync
backend, eventlog, and SQLite materialization path. This exercises the current
production-shaped critical sections without requiring one OS process or
browser per client.

Later profiles must preserve scenario semantics and trace vocabulary. A
scenario that only uses capabilities supported by several profiles should be
runnable unchanged across them.

### Time and Scheduling

Correctness runs and performance runs need different notions of time:

- **Logical/virtual time** is the default for deterministic correctness runs.
  The runner controls timers, scheduled faults, workload rates, and relevant
  runner-owned delivery delays.
- **Wall-clock time** is required for throughput, latency, CPU, and memory
  measurements.

Every generated choice must derive from a recorded seed. Where execution still
depends on nondeterministic host scheduling, the runner should record observed
ordering decisions in the run artifact.

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
selected provider profile.

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
adversarial transport profile is requested. Otherwise the harness risks
finding failures in impossible systems.

### Read Models and SQLite

Sync correctness and materialized-state correctness are related but distinct:

1. **Sync correctness:** clients converge on the authoritative eventlog order,
   with no silent event loss or duplication.
2. **Full-stack correctness:** after eventlog convergence, the clients'
   materialized state also converges and can be reproduced from that eventlog.

The scenario model should not define SQLite as part of sync semantics. It
should select a state profile supplied by the application definition and
execution profile.

The initial full-stack profile should nevertheless include SQLite because the
current processors integrate materialization into important behavior:

- session rebases roll back SQLite changesets;
- leader pulls and local pushes materialize batches;
- leader state and eventlog transactions are coordinated; and
- materializer failures can terminate the runtime.

An eventlog-only profile would isolate the sync protocol, but implementing it
before the planned sync/read-model separation may create a test-only seam that
does not represent the running product. The runner boundary should permit that
profile later without requiring a new scenario language.

### Trace Protocol

The runner emits one normalized trace for live observation and replay. The
visualizer never needs private access to participant internals outside this
contract.

Every trace record should carry:

- scenario and run identifiers;
- logical time and, where meaningful, wall-clock time;
- participant, role, and boundary identifiers;
- record type and structured payload;
- event, batch, request, and causal-parent identifiers where applicable;
- local, upstream, and backend heads where observed;
- rebase generation;
- execution profile and component version information; and
- severity or failure classification.

Initial record families should cover:

- participant lifecycle and connectivity;
- scenario actions and generated application events;
- push, pull, confirmation, retry, and failure transitions;
- batches crossing session/leader and leader/backend boundaries;
- queue and buffer depths;
- advance and rebase outcomes;
- state rollback and materialization phases;
- oracle progress and verdicts; and
- optional performance measurements.

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
- execution profile and environment metadata;
- seed and recorded scheduling decisions;
- complete or policy-filtered trace;
- oracle results and failure explanation;
- relevant eventlog and state snapshots; and
- performance measurements when wall-clock mode is enabled.

The minimum reproduction command should need only the artifact and the matching
source revision. Automated shrinking or minimization of a failing workload is
desirable but can follow deterministic reproduction.

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

## Delivery Sequence

The architecture can be delivered incrementally:

1. **Semantic model:** settle participants, scheduling, workloads, faults,
   trace vocabulary, and oracle definitions; select the concrete file format.
2. **Headless in-process runner:** real sync processors, mock backend, SQLite,
   explicit actions, basic disconnect/reconnect faults, convergence oracles,
   and reproducible artifacts.
3. **Generated stress scenarios:** reusable workloads, seeded scheduling,
   conditional actions, richer faults, resource observations, and failure
   minimization.
4. **Visualization:** live trace transport, saved-run replay, system view,
   timeline view, and participant drill-down.
5. **Additional fidelity profiles:** workers/processes, browsers, concrete
   providers, and alternative read models when their product boundaries exist.
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
runs slow and operationally expensive. High-fidelity profiles should validate
the same scenario semantics selectively; they should not be the minimum unit
of simulation.

### Couple the runner and dashboard

A UI-driven runner is attractive for exploration but prevents cheap CI runs
and makes failures harder to reproduce. A trace boundary supports both live UI
use and independent headless execution.

### Make SQLite mandatory in the scenario language

This matches the current implementation but would make the sync verification
model depend permanently on one read model. SQLite should be the initial
full-stack profile, not part of the scenario's definition of sync.

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

1. What is the exact minimum component boundary for the first in-process
   profile, and can the real processors be instantiated without introducing
   simulation-only abstractions into production code?
2. Should SQLite materialization be mandatory in version one, or should the
   first delivery include both eventlog-only and full-stack profiles?
3. Which concrete scenario syntax best balances authoring, schema validation,
   comments, composition, and canonical formatting?
4. What is the smallest application-definition API that supports event
   construction, generated values, materialization, and state comparison?
5. Which scheduling decisions can be made deterministic with virtual time,
   and which host/runtime interleavings must instead be recorded?
6. At which abstraction should latency and partitions be injected for each
   execution profile?
7. What constitutes quiescence when providers can use live pull streams,
   polling, retries, and indefinitely pending events?
8. Which trace fields are stable public contracts, and which are optional
   diagnostic details tied to one implementation?
9. How should large traces be sampled, compressed, or streamed without losing
   the causal evidence needed to explain a failure?
10. When should invalid application events, malformed protocol payloads, and
    impossible transport behavior become supported adversarial modes?
11. Which browser/process profile is sufficient to validate that the
    in-process runner has not hidden meaningful boundary behavior?
12. How should failing generated scenarios be minimized while preserving the
    causal interleaving that triggered the failure?
13. Which correctness scenarios can also produce trustworthy performance
    evidence, and which require a separate wall-clock configuration?
14. Where should the accepted architecture fold into the verification intent
    layer: a new `06-simulation/` node or refinements to lanes, performance,
    and determinism?
