# Verification — Intuition

*For: contributors adding tests or realizations · Assumes:
[../intuition.md](../intuition.md) · Covers: what kind of evidence proves
which kind of claim*

## Contracts are only real if something fails when they break

This tree is full of strong claims — determinism, glitch-freedom,
convergence, "any provider works." Verification is the node that turns each
claim into something executable. The mental model is a mapping from claim
shape to evidence shape:

| Claim shape | Evidence shape |
| --- | --- |
| Pure semantics (sync merge, seq numbers) | Unit tests in `e{n}` notation, no I/O |
| Cross-package behavior | Integration lanes (Vitest, Playwright) |
| "Any realization of contract X works" | One shared conformance suite, run by all |
| Performance promise (LS-R14) | Maintained perf suites with comparable runs |
| Protocol stability (devtools, sync) | Executable compatibility tests |
| Determinism | Runtime hash checks, not convention |

## Conformance is the flip side of pluggability

Every pluggable dimension needs a realization-independent suite — otherwise
"pluggable" means "works with the one implementation we tried." Sync
providers already have this: `tests/sync-provider/` drives the provider
interface directly, so an in-repo, contrib, or custom backend all face the
same questions (connection lifecycle, cursor/live pull, large batches).
Adapter and framework-integration suites are now contracted but not yet
built (open deltas in
[02-conformance/](./02-conformance/requirements.md)); read-model
conformance remains the open question (LS.SYS.VER.CONF-DQ1).

## Where evidence lives

Lanes are runnable locally (`mono test <unit|integration|perf>`); CI
mechanics belong to [../../03-delivery/](../../03-delivery/spec.md). When a
benchmark, prototype, or validation run *informs a contract* — settles a
design question, justifies a requirement — its record belongs in the owning
node's `.experiments/`, so the spec can stay timeless while the evidence
trail stays findable.

Perf gating is contracted (LS.SYS.VER.PERF-R02) but not built — the suites
currently measure without persisting or thresholding; concrete budget
values remain open (LS.SYS.VER.PERF-DQ1).
