# DELTA-001 — Snapshot publishing gated on the whole `ci` run conclusion

Status: open

## Divergence

Snapshot publishing should depend only on the build/test jobs that actually
establish a release is sound, not on the entire `ci` workflow concluding
`success`. Today it is gated on the whole run: `release.yml`
`publish-snapshot-version` runs `if: workflow_run.conclusion == 'success'`, so
*any* red `ci` job — including non-release-blocking ones (a governance check, a
flaky preview deploy, `report-pr-preview`) — silently wedges snapshot releases.

This was the original defect behind the ruleset-reconcile work (#1424): a
`ruleset-drift-check` failure set the whole `ci` conclusion to `failure` and
stalled snapshots. Moving ruleset reconciliation out of `ci` (spec §Ruleset
Reconciliation, LS.DEL.REL-DQ2) removes *that* trigger but not the general
coupling.

## VRS

[spec.md](../spec.md) §Open Design Questions LS.DEL.REL-DQ2. The
ruleset-reconcile absorption (2026-07-18) recommends promoting the
"snapshots must not gate on whole-`ci` conclusion" rule to a normative
`LS.DEL.REL` requirement; that promotion is a protected `requirements.md` edit
pending owner confirmation.

## Close condition

`publish-snapshot-version` is gated on the specific build/test jobs (or an
independent trigger), so a non-release job's failure can no longer block
snapshots. Close when a red non-release `ci` job no longer wedges a snapshot.
