# 0003 — Host the Scenario runner/viewer realization in contrib

Status: accepted (maintainer migration direction, 2026-07-29; tracked in
livestorejs/livestore#1517)

## Context

The Scenario contract constrains LiveStore verification across repositories,
while the runner, Participant hosts, backend profiles, corpus, artifacts, and
viewer form one fast-evolving private realization. Keeping that realization in
core would require root workspace, TypeScript, Vitest, browser, and lockfile
wiring that exists only for contributor tooling.

The product already uses a two-repository contract/realization pattern:
canonical `LS.*` contracts and registries live in core; contrib implementation
intent uses its own `LSC.*` IDs and cites the core requirements.

## Options

- **Keep contract and realization together in core (rejected).** This couples
  product package delivery to private Scenario tooling and its browser/runtime
  dependencies.
- **Move both contract and realization to contrib (rejected).** This makes
  cross-system evidence semantics subordinate to one implementation.
- **Keep the contract in core and host the realization plus implementation
  intent in contrib (chosen).**

## Decision

Core owns `context/02-system/09-verification/06-scenarios/`,
`LS.SYS.VER.SCEN-*`, canonical terminology, and generalized package seams.
`livestore-contrib` owns the runner/viewer realization at
`context/verification/scenarios/`, including profiles, backend realizations,
corpus, artifacts, UI decisions, and implementation deltas.

Core lists that realization in [realizations.md](../realizations.md). Contrib
cites the core requirement IDs and pins a merged core revision containing the
contract and any consumed seams.

## Consequences

- No Scenario workspace, artifact, viewer, or Scenario-only root wiring is
  registered in core.
- Implementation gaps and realization-specific decisions are not duplicated as
  core deltas.
- Contrib cannot pin this draft PR's fork commit as a durable dependency; it
  repins to the eventual upstream merge commit before integration.
