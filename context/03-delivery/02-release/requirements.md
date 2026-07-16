# Delivery Release — Requirements

Role: owns how versions get published — the lockstep core→contrib release
flow, publish-time dependency rewriting, and the dependency-update policy.

## Context

Builds on the parent [requirements.md](../requirements.md). IDs re-homed
2026-07-16 from the former flat `LS.DEL-*` set: T02→T01; R03→R01, R11→R02,
R13→R03, R14→R04, R15→R05; DQ2→DQ1. Companion runbooks (owned by this node;
the normative contract stays here):
[package-release-runbook.md](./package-release-runbook.md),
[release-workflows-runbook.md](./release-workflows-runbook.md),
[dependency-management.md](./dependency-management.md).

## Acceptable Tradeoffs

- **LS.DEL.REL-T01 Lockstep contrib releases:** Contrib mirrors core's
  version stamp and can release even when contrib source did not change.
  Extra release events are acceptable because users get deterministic "same
  version was tested together" semantics.

## Requirements

- **LS.DEL.REL-R01 Single publisher per package:** Each published package is
  published by exactly one repository's release workflow.
  `refines: LS-R16`
- **LS.DEL.REL-R02 Exact versions at publish:** Contrib release manifests
  rewrite `workspace:*` dependencies on core packages to exact published
  versions.
- **LS.DEL.REL-R03 Mirrored version stamp:** A contrib release uses the
  latest core version stamp exactly.
- **LS.DEL.REL-R04 Core-triggered contrib release:** Core's release workflow
  dispatches the matching contrib release after core packages publish.
- **LS.DEL.REL-R05 Manual contrib release escape hatch:** Contrib can
  manually publish the current core version stamp for a contrib-only release
  repair.
- **LS.DEL.REL-R06 Breaking-change classification:** Every breaking change
  is classified as one of three kinds — API, client storage format
  (`liveStoreStorageFormatVersion` bump), or sync backend storage format —
  and release notes state the kind plus a migration path where feasible.
  The user-facing promise lives in `01-product/` LS.PROD-R08. Adopted
  2026-07-16 (interview).
