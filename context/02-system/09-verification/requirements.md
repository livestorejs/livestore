# Verification — Requirements

Defines how LiveStore proves its own contracts: test lanes, conformance
suites for the pluggable dimensions, performance evidence, protocol
compatibility, and determinism guards. Refines the realization-proving and
performance criteria of the root ([LS-R08], [LS-R14]; vision success
criterion 6).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). CI
mechanics (runners, workflows) are owned by `../../03-delivery/`; this node
owns what is verified and by what kind of evidence.

All requirements live in the child nodes; the former `LS.SYS.VER-R01…R06`
were re-homed on 2026-07-16:

| Child | Owns | Re-homed IDs |
| --- | --- | --- |
| [01-lanes/](./01-lanes/requirements.md) | Lane taxonomy, local/CI invocation | R01 → `LS.SYS.VER.LANE-R01` |
| [02-conformance/](./02-conformance/requirements.md) | Dimension conformance suites | R02 → `LS.SYS.VER.CONF-R01`, R03 → `LS.SYS.VER.CONF-R02` |
| [03-performance/](./03-performance/requirements.md) | Perf evidence | R04 → `LS.SYS.VER.PERF-R01` |
| [04-protocol-compat/](./04-protocol-compat/requirements.md) | Protocol compat tests | R05 → `LS.SYS.VER.PROTO-R01` |
| [05-determinism/](./05-determinism/requirements.md) | Determinism guards | R06 → `LS.SYS.VER.DET-R01` |
