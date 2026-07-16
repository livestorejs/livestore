# Verification — Spec

This document specifies LiveStore's verification architecture at the
contract level; the mechanics live in the child nodes. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Shape

Verification maps claim shapes to evidence shapes (see
[intuition.md](./intuition.md)); each evidence shape is owned by one child:

| Child | Evidence shape |
| --- | --- |
| [01-lanes/](./01-lanes/spec.md) | Runnable lanes: unit, integration, substrate, perf, examples |
| [02-conformance/](./02-conformance/spec.md) | Realization-independent suites per pluggable dimension |
| [03-performance/](./03-performance/spec.md) | Latency/memory measurement suites |
| [04-protocol-compat/](./04-protocol-compat/spec.md) | Executable protocol-compatibility tests |
| [05-determinism/](./05-determinism/spec.md) | Determinism guards and (missing) oracles |

Evidence conventions: benchmark results, prototype outcomes, and validation
runs that inform contracts are recorded as `.experiments/` records in the
owning node, per the meta-VRS contract.
