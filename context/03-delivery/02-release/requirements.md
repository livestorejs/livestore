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
- **LS.DEL.REL-R07 Snapshot publishing isolation:** Snapshot publishing must
  not be gated on the whole `ci` run conclusion — a job that does not establish
  release soundness (governance, preview deploy, reporting) must not be able to
  wedge a snapshot release. Currently violated (`publish-snapshot-version` keys
  off `workflow_run.conclusion == 'success'`); tracked in
  [.delta/DELTA-001](./.delta/DELTA-001-snapshot-gated-on-ci-conclusion.md).
  Adopted 2026-07-18 (owner-confirmed).
- **LS.DEL.REL-R08 Registry-verified releases:** After publishing, every package
  in the release group is verified against what the registry actually serves:
  the version is visible, the served tarball digest matches the locally packed
  artifact, and the release's dist-tag resolves to exactly that version.
  Verification failure fails the release rather than being reported after the
  fact. Registry propagation may be retried; a digest that disagrees with the
  packed artifact may not. The dist-tag clause is what makes a partial release
  — version published but `latest` still resolving to the previous release —
  a release-time failure instead of a silent one users discover on install.
  Adopted 2026-07-27 (owner-confirmed).
- **LS.DEL.REL-R09 Attested stable releases:** Stable package publishing emits
  SLSA provenance from the workflow's OIDC identity, so every artifact we ship
  to users is attested. Snapshot and DevTools artifact publishing already do;
  without this, stable releases are the only unattested artifact.
  Adopted 2026-07-27 (owner-confirmed).
