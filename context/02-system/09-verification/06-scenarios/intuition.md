# Scenario-Based Sync Verification — Intuition

*For: contributors investigating sync correctness · Assumes:
[../intuition.md](../intuition.md) · Covers: why reproducible Scenarios are a
separate verification evidence shape*

## Focused tests prove parts; Scenarios prove compositions

Unit and conformance tests remain the fastest way to prove a local invariant.
They do not show how Stores, session and Leader processors, materialization,
queues, retries, topology changes, faults, and Recovery behave together over a
long run. A Scenario makes that composition reviewable and reproducible without
reimplementing LiveStore as a second behavioral model.

```text
typed Scenario source → serializable Scenario AST → runner
                                                   │
                                                   ▼
Scenario oracle ← Scenario trace ← real LiveStore components
       │
       └── verdict + reproducible run artifact
```

The Scenario runner is a correctness falsifier and reproducer, not a proof that
LiveStore is correct for every workload, schedule, fault, or Execution
configuration. A passing run means no declared Scenario property was violated
by the recorded inputs and observations; it does not rule out a counterexample
elsewhere.

## Control is not observation

“Disconnect Client A” is an instruction. “Client A reported offline” is an
observation. Scenario traces keep instructions, Control acknowledgements,
Operation outcomes, observations, and Scenario verdicts distinct. Correlation
groups evidence about the same operation; only explicit dependency/causation
edges and participant-local sequence order it.

A timeout deserves particular care. A child process or browser may apply a
request and then lose its response. That is an indefinite Operation outcome,
not evidence that the operation did not happen.

## Fast evidence and faithful evidence answer different questions

A controlled profile asks whether the composed sync system is correct under a
particular workload, schedule, topology, and fault sequence. Platform-realized
profiles add evidence about persistence, transport, leadership, and lifecycle
boundaries. Results are scoped to their profile; cross-profile comparison is
useful when explicitly requested, not an implied equivalence guarantee.

## Convergence is an explicit claim

Open streams, future polling, and telemetry mean “nothing is running” is not a
useful definition of completion. A settle phase instead names the participants
expected to converge, the faults whose injection must stop, the work that must
become quiescent, the barrier that confirms stable Convergence, and the timeout
that bounds the claim. Fault removal is followed by separately observed
Recovery; it does not prove it.

Settlement answers whether the declared convergence barrier completed. After
that, Scenario oracles evaluate Scenario properties and emit verdicts. A
property can fail a settled run without rewriting the convergence evidence.

Head alignment alone is not proof of Eventlog convergence. Two participants can
report the same backend head while one has lost, duplicated, reordered, or
replaced an Event behind that head. Eventlog convergence and State convergence
are also different evidence: a profile may exercise a concrete State
realization while the Scenario language keeps sync semantics independent of it.
