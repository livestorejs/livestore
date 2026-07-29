# Scenario-Based Sync Verification — Spec

This document specifies reproducible system-wide verification Scenarios. It
builds on [requirements.md](./requirements.md); rationale lives in
[intuition.md](./intuition.md).

## Status

Draft.

## Scope and Ownership

This node owns Scenario semantics, plans, participant-host control, capability
and evidence boundaries, fault and time semantics, reproduction, Settlement,
Scenario traces, Scenario oracles, run artifacts, profile conformance, and
truth-preserving visualization.

Sync, runtime, State, Store, and observability nodes own the product behavior
being exercised. Scenario code may request the smallest generalized
observation or control seam from those owners, using an explicit internal
testing export when the seam is not product API. Scenario-specific product
instrumentation is not assumed by this contract.

The runner/viewer and its implementation intent are contrib-owned. Core records
that realization in [realizations.md](./realizations.md) and owns no Scenario
workspace, artifacts, or implementation delta. See
[decision 0003](./.decisions/0003-contrib-runner-viewer-realization.md).

## Architecture

```text
typed Scenario source
        │
        ▼
validation + normalization
        │
        ▼
versioned Scenario AST ──▶ Scenario runner ──▶ Participant hosts
                                  │                  + backend realization
                                  ▼
                            Scenario trace
                                  │
                 ┌────────────────┼─────────────────────┐
                 ▼                ▼                     ▼
       Operation history    Scenario oracles     live/replay viewer
                                  │                     │
                                  └──────▶ run artifact ◀┘
```

Scenario semantics, runner control, trace protocol, oracles, and consumers are
separate contracts. Headless execution is authoritative; visualization is a
consumer of the same evidence.

## Scenario Semantic Model (LS.SYS.VER.SCEN-R01, R02)

The authoring surface is typed TypeScript using Effect Schema-backed
declarative constructors. It normalizes to a versioned, serializable AST. JSON
may encode that AST in artifacts or across transports, but arbitrary
TypeScript/Effect programs are not portable Scenario control.

The AST carries stable Scenario and Application identity, seed, Execution
configuration, topology, lifecycle, Workload patterns, schedule, faults,
completion, selected properties/oracles, and capture policy. All run-specific
control is represented by normalized data.

An Application definition wraps the actual `LiveStoreSchema`; it does not
redeclare Event definitions or materializers. Named application actions with
schema-encoded inputs are the portable mutation boundary. Optional State
inspectors read already-materialized State and return normalized encoded
values. Rematerialization uses the Application's normal schema and materializers
rather than a Scenario-side substitute.

## Topology and Plans (LS.SYS.VER.SCEN-R03, R04)

The topology reflects LiveStore's product boundaries:

```text
Sync backend
    ▲
    │ provider boundary
Client
  ├─ Leader role
  └─ Client session(s) ── leader-proxy boundary ──▶ Leader role
```

A Client is the stable top-level Scenario participant and owns shared local
data, one active Leader role, and one or more Client-session participants. The
Leader is an observable role within its Client, not a separate participant.
The Sync backend is a separate topology component.

Plans may sequence or compose:

| Family | Meaning |
| --- | --- |
| Application | Invoke a named Application action |
| Lifecycle | Create a Client; add, stop, or restart a supported runtime |
| Connectivity/fault | Inject or remove a supported adverse condition |
| Workload | Expand a named, parameterized, seeded pattern |
| Scheduling | Sequence, bounded parallelism, logical timing, repetition, condition wait |
| Settlement | Stop work, remove named faults, establish a Convergence group, evaluate a barrier |

Creation, lifecycle, connectivity, and deletion are distinct semantics.
Stopping a session does not delete its Client's local data; disconnecting a
Client does not stop its runtime. Any control that terminates a Client, deletes
persistence, revokes access, or excludes a participant from Convergence must
name that meaning directly.

Instructions and observations are distinct. A Control acknowledgement proves
only Participant-host handling at its advertised boundary. A timeout or lost
transport can leave an Operation outcome indefinite.

## Execution Configuration (LS.SYS.VER.SCEN-R05…R08)

An Execution configuration composes:

```text
Participant execution profile
        +
Sync-backend realization
        +
optional State profile/capabilities
```

The runner derives required capabilities from topology, operations,
observations, and selected oracles, then validates them before creating a
participant. Unsupported configurations fail preflight. Profiles describe real
guarantees and need not implement every Cartesian combination.

Every profile realizes a transport-neutral Participant-host contract that can
create and control participants, dispatch serialized named actions, advertise
capabilities, classify host failures, and emit stable Scenario trace records
without exposing Participant objects to the runner.

A profile claiming production-shaped composed-system evidence uses the actual
Stores, processors, materializers, adapters, and selected State realization at
the boundaries under test. A pure merge model or runner-side state simulation
may be useful subordinate evidence but cannot make that claim.

Every implemented host passes one shared conformance suite for the capabilities
it advertises. A result is evidence only about its selected profile. Optional
cross-profile comparison names the semantic properties compared rather than
assuming byte-identical traces or one-to-one outcomes.

## Time, Scheduling, and Reproduction (LS.SYS.VER.SCEN-R09, R10, R19)

Logical time orders Scenario-owned plan and trace facts and may control
explicitly advertised runner-owned scheduling. Participant-local monotonic
time and calibrated Scenario time describe observed elapsed time. Wall-clock
time supplies externally comparable performance evidence. None participates
in LiveStore synchronization.

Participant-local sequence establishes observed order within one participant.
Explicit instruction/acknowledgement, request/response, boundary-transition,
dependency, and causation records establish supported cross-participant
relationships. Correlation, timestamp order, and Observation-capture membership
alone create no causal edge.

A cross-process timing profile records local monotonic time and calibration
evidence sufficient to estimate a Scenario-time interval with explicit
uncertainty. Overlapping intervals remain unordered. Timing that contradicts a
known causal edge beyond its uncertainty is an instrumentation defect, not
permission to rewrite causal order.

Every generated choice derives from the recorded seed. This reproduces inputs,
requested timing, workloads, and fault choices, but not internal host or sync
interleaving. Recorded boundary replay is a separate capability: it names the
boundaries controlled, records their release decisions, and reports the first
divergence.

## Fault Semantics (LS.SYS.VER.SCEN-R11)

Fault injection occurs at the highest boundary that still exercises the target
behavior. A Participant connectivity fault is distinct from shared backend
unavailability. Schema-invalid Events, malformed protocol payloads, impossible
reordering, or packet-level corruption require an explicitly adversarial
realization and never silently weaken a production-shaped claim.

The trace distinguishes Fault injection, Fault removal, Recovery observation,
Recovery completion, and Settlement. Removing a fault ends only the injected
condition.

## Scenario Trace Protocol (LS.SYS.VER.SCEN-R13, R19, R21)

Every record carries protocol version, run and record identity, runner receipt
index, payload kind and version, component/participant scope, correlation,
causal dependencies when known, and typed payload data. Participant-local
sequence and timing evidence are present when supplied by the profile.

Portable payload families include run and phase boundaries, instructions,
Control acknowledgements, Operation outcomes, topology/lifecycle changes,
faults and Recovery, backend/Leader/session observations, application actions,
Settlement, Scenario verdicts, and failures.

An Observation capture groups facts sampled during one collection pass. It is
not an atomic distributed snapshot and does not prove simultaneous transitions.
Records distinguish an instrumented transition from a fact first observed by
sampling.

Operation identity spans its instruction, host response, related observations,
and outcome. Outcome certainty is separate from Participant-host failure
category. A derived Operation history declares which operation families and
invocation/completion boundaries it covers; the Scenario trace remains the
authoritative evidence envelope.

Portable consumers ignore unknown namespaced diagnostics. Private queue depth,
SQLite details, provider payloads, runtime stack traces, and OTel data do not
become portable evidence merely because a realization records them.

## Event Identity and Observation

Scrubbing selects a monotonically increasing observation-index boundary and
projects the complete trace prefix. It never claims an atomic global state.

When a profile can prove Event lineage, it assigns a run-local Event reference
to actual encoded Event facts and carries it through explicit rebase,
confirmation, rejection, and propagation mappings. Equivalent fields,
positions, timing, or occurrence order are insufficient to prove lineage.
Without that capability, correlation may aid debugging but oracles and causal
projections must not treat it as identity evidence.

Participant hosts and backend realizations observe actual LiveStore State,
Eventlogs, and boundary transitions rather than simulating product state from
runner instructions. Scenario verification alone does not justify adding
lineage fields or hot-path observers to the sync engine.

## Properties, Oracles, and Settlement (LS.SYS.VER.SCEN-R14, R15)

Scenario properties are explicit claims under declared assumptions. Scenario
oracles return bounded verdicts with evidence references. Property families
include Eventlog safety and Convergence, pending resolution, rebase
preservation, State convergence, rematerialization, liveness, resource bounds,
and optional performance thresholds.

A settle phase:

1. stops new Workload actions and awaits dispatched Control acknowledgements;
2. removes the named injected faults;
3. declares the Convergence group and intentional exclusions; and
4. evaluates a profile-appropriate bounded barrier.

Successful Settlement requires Quiescence plus the declared stable
Convergence predicate. Matching heads alone are insufficient proof of equal
Eventlogs. Oracle evaluation follows Settlement and cannot change whether the
barrier completed. A trace-history oracle may omit Settlement only when its
contract needs no terminal snapshot.

Rebase preservation and practical bounded liveness are compositional claims:
they combine Operation outcomes, Recovery/Settlement evidence, Eventlog
properties, and Application State evidence rather than inventing a hidden
single signal. A timeout preserves the last available evidence and emits a
failed boundary; increasing a timeout is not a substitute for an observable
barrier.

## Artifacts and Visualization (LS.SYS.VER.SCEN-R16, R17, R20)

A Scenario run artifact contains the normalized AST, Application/source
identity, component versions, Execution configuration, environment metadata,
seed, controlled schedule when present, Scenario trace, verdicts, failure
explanation, and relevant snapshots or measurements.

Once execution begins, an Operation failure still produces a valid failed
artifact containing the complete available trace prefix. Preflight validation
may fail without an artifact because no participant execution began.

The viewer consumes a live trace or completed artifact. Any control goes
through an explicit runner API; the viewer never inspects or mutates
participants directly.

The same immutable records support:

- a causal-flow projection exposing partial-order structure without claiming
  sibling transitions were simultaneous; and
- an elapsed-time projection exposing delay and uncertainty without claiming
  timestamp order is causality.

Aggregation, semantic zoom, visibility filtering, and derived playback moments
do not remove access to raw records or define a second cursor. Record playback
visits every observation-index boundary; moment playback may visit a derived
subset while still reducing the complete trace prefix. Selecting a record for
inspection does not change projected system state.

## Repository Boundary (LS.SYS.VER.SCEN-R18)

The canonical contract, terminology, and generalized core testing seams live
in this repository. The runner/viewer realization and all Scenario-specific
implementation intent live in `livestore-contrib`:

```text
livestore-contrib Scenario realization ── uses ──▶ @livestore/*
@livestore/* ── must not depend on ──▶ contrib Scenario realization
```

The contrib intent node cites the `LS.SYS.VER.SCEN-*` requirements and records
realization-specific profiles, paths, deltas, and implementation decisions.
Core's [realizations.md](./realizations.md) remains the cross-repository
registry.

## Open Design Questions

- **LS.SYS.VER.SCEN-DQ1 Failure minimization:** How are generated failing runs
  minimized without destroying the causal interleaving?
- **LS.SYS.VER.SCEN-DQ2 Trace retention:** How are large traces sampled,
  compressed, referenced, or streamed without losing causal evidence?
- **LS.SYS.VER.SCEN-DQ3 Performance reuse:** Which correctness Scenarios can
  also provide trustworthy wall-clock evidence, and which require distinct
  configurations?
