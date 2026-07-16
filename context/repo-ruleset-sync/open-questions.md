# Ruleset reconciliation — Open questions

## OQ4 — Absorb this subsystem into the hierarchical intent layer (#1406)

This `context/repo-ruleset-sync/` VRS uses the pre-hierarchy flat convention
(non-hidden `decisions/`/`reference/`, no `## Status` sections, no `LS.*` IDs).
PR livestorejs/livestore#1406 establishes the canonical hierarchical intent
layer and **absorbs** the sibling flat roots (`repo-architecture`,
`devtools-artifact-release`). This subsystem must be absorbed the same way.

- **Target:** `context/03-delivery/02-release/` (release governance).
- **Capture:** (1) the ruleset auto-reconcile design + decision (from
  [spec.md](./spec.md), [decisions/0001](./decisions/0001-github-app-definition-as-iac.md),
  [reference](./reference/github-app-platform-constraints.md)); (2) [OQ1](#oq1--decouple-snapshot-publishing-from-the-whole-ci-conclusion)
  as a requirement + `.delta` (snapshot publishing must not be gated on the
  whole `ci` conclusion — currently violated); (3) the manual App-provisioning
  runbook (from spec.md) next to `release-workflows-runbook.md`.
- **Then:** delete this directory, add the new namespace to `context/spec.md`'s
  ID Scheme table, note the absorption in `.delta/DELTA-001`.
- **Forcing function:** this directory intentionally does not satisfy #1406's
  intent-layer enforcement suite, so once that suite reaches `main` it will fail
  until this subsystem is absorbed — do not "conform in place", absorb.

Detail + coordination: livestorejs/livestore#1406 comment (issuecomment-4992697046).

Status: **open** — owned by the #1406 (VRS) workstream; sequencing: #1424 merges
before #1406.

## OQ1 — Decouple snapshot publishing from the whole `ci` conclusion

Removing the hard ruleset drift-gate (spec: Gate removal) stops *this* governance
job from wedging releases, but snapshot publishing is still gated on the entire
`ci` run concluding `success` (`release.yml` `publish-snapshot-version` `if:
workflow_run.conclusion == 'success'`). Any future required job that fails for
non-release reasons would still block snapshots. A durable fix gates the snapshot
job on the specific build/test jobs rather than whole-workflow conclusion, or
publishes on an independent trigger.

Status: **open** — out of scope for the ruleset-reconcile change; recommended as
a follow-up. Not blocked.

## OQ3 — Parameterize the repo target for contrib enrollment

`scripts/src/commands/github.ts` hardcodes `OWNER = 'livestorejs'` /
`REPO = 'livestore'`, so `mono github rulesets sync|check|plan` only targets
core. Topology A (one shared App across both repos) requires contrib's
genie-composed tooling to target `livestore-contrib` — i.e. the owner/repo must
be parameterized (env or flag) before contrib can enroll. `mono github app check`
is App-level (`GET /app`) and already repo-agnostic. Not needed for the core
rollout; required at contrib-enrollment time.

Status: **open** — deferred to contrib enrollment. Not blocked.

## OQ2 — Alchemy `GitHub.App` adoption

If [alchemy-run/alchemy#843](https://github.com/alchemy-run/alchemy/issues/843)
ships a `GitHub.App` resource, the manifest-as-spec + custom drift-check can be
replaced by a real Alchemy resource with read/diff built in.

Status: **blocked** on upstream #843.
