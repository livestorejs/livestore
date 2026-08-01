# Verification — Requirements

Defines how LiveStore proves its own contracts: test lanes, conformance
suites for the pluggable dimensions, performance evidence, protocol
compatibility, determinism guards, and reproducible composed-system evidence.
Refines the root's correctness, realization-proving, and performance criteria
([LS-R03], [LS-R05], [LS-R06], [LS-R08], [LS-R10], [LS-R13], and [LS-R14];
vision success criterion 6).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). CI
mechanics (runners, workflows) are owned by `../../03-delivery/`; this node
owns what is verified and by what kind of evidence.

## Requirements

- **LS.SYS.VER-R07 Traceability annotations:** Test files declare which
  intent-layer requirements they evidence via a `Verifies:` comment line
  listing `LS.*` IDs (format and honesty rule in
  [spec.md](./spec.md) §Traceability Annotations); annotations are
  comments only and never alter test behavior. Adopted 2026-07-16
  (interview).
- **LS.SYS.VER-R08 Composed-system verification:** Verification includes
  reproducible evidence for multi-Client Sync behavior across topology changes,
  disconnection, faults, recovery, and convergence. It exercises actual
  LiveStore boundaries, states the scope and assumptions of its claims, and
  retains enough input, source, observation, and outcome context to reproduce
  and diagnose failures without treating requested controls as observed
  behavior. `refines: LS-R03, LS-R05, LS-R06, LS-R08, LS-R10, LS-R13`

Lane/dimension requirements live in the child nodes; the former
`LS.SYS.VER-R01…R06` were re-homed on 2026-07-16:

| Child | Owns | Re-homed IDs |
| --- | --- | --- |
| [01-lanes/](./01-lanes/requirements.md) | Lane taxonomy, local/CI invocation | R01 → `LS.SYS.VER.LANE-R01` |
| [02-conformance/](./02-conformance/requirements.md) | Dimension conformance suites | R02 → `LS.SYS.VER.CONF-R01`, R03 → `LS.SYS.VER.CONF-R02` |
| [03-performance/](./03-performance/requirements.md) | Perf evidence | R04 → `LS.SYS.VER.PERF-R01` |
| [04-protocol-compat/](./04-protocol-compat/requirements.md) | Protocol compat tests | R05 → `LS.SYS.VER.PROTO-R01` |
| [05-determinism/](./05-determinism/requirements.md) | Determinism guards | R06 → `LS.SYS.VER.DET-R01` |
