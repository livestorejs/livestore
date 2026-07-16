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

## Traceability Annotations

Requirement↔evidence traceability lives in the test code, not a central
matrix (decided 2026-07-16, interview). A test file declares which
intent-layer requirements it evidences via a `Verifies:` line listing
`LS.*` IDs in a JSDoc-style comment at the file or describe-block level:

```ts
/** Verifies: LS.SYS.SYNC.SS-R02, LS.SYS.SYNC.SS-R06 */
```

Rules:

- Comments only — annotations never change test names or behavior.
- Appending the `Verifies:` line to an existing header comment is
  preferred over adding a second comment block.
- Honesty rule: annotate only what the test genuinely asserts, not the
  requirement's whole neighborhood. A test that exercises a mechanism
  without asserting the contracted property does not verify it.
- Requirements without any `Verifies:` annotation are simply unverified —
  that is honest state, not an error.

A future enforcement check can grep `Verifies:` coverage (which IDs have
evidence, and that annotated IDs exist); not built today.
