# 0005 — Preserve Operation, Settlement, and property evidence boundaries

Status: accepted (maintainer implementation reviews, 2026-07-22 to 2026-07-28)

## Context

Instructions, host responses, sampled observations, Recovery, Settlement, and
property verdicts answer different questions. Collapsing them into one success
signal would hide indefinite outcomes, make Fault removal look like Recovery,
or let a later oracle rewrite whether the system reached a stable barrier.

## Decision

- Every runner-invoked Scenario operation has stable identity across
  instruction, response, observation, and outcome evidence. Outcome certainty
  is independent from Participant-host failure category.
- A Settlement barrier establishes bounded Quiescence and Convergence for a
  declared group. It does not prove Eventlog contents, State equality, or a
  later Scenario property.
- Scenario oracles evaluate explicit properties from retained evidence and emit
  separate verdicts. Rebase preservation and bounded liveness are compositional
  claims over Operation, Recovery, Settlement, Eventlog, and State evidence.
- A failed execution preserves the available trace prefix in a failed artifact
  once the run has begun.

## Consequences

- A timeout or lost response may produce an indefinite outcome even when the
  requested effect occurred.
- Fault removal precedes independently observed Recovery.
- Matching heads are insufficient for Eventlog-convergence success.
- Trace-history oracles declare their sampling and coverage limits.
- A failed property may fail a settled run without rewriting Settlement.
