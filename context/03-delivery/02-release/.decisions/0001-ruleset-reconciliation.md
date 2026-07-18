# Ruleset reconciliation — key decisions

Status: accepted (2026-07-17) — design agreed and implemented via livestorejs/livestore#1424; absorbed into this node 2026-07-18.

Durable decisions behind reconciling the repository branch ruleset from the
committed desired-state file (`.github/repo-settings.json`) using an org-owned
GitHub App as the privileged identity.

## Reconcile Via a GitHub App, Not a Stored Admin PAT

The privileged identity that applies desired ruleset state to GitHub is an
org-owned GitHub App, whose installation mints short-lived tokens per run.

| Option | Rejected because |
| ------ | ---------------- |
| Long-lived fine-grained PAT (`LIVESTORE_RULESET_ADMIN_TOKEN`) | Broad, long-lived admin secret tied to one account; fine-grained PATs expire (≤1y) → silent revert to check-only, re-creating the exact "drift silently wedges releases" failure on a delayed fuse |
| Default `GITHUB_TOKEN` | Cannot manage repo rulesets; no `administration` scope grantable to the default token |

The App's tokens are short-lived and least-privilege (`administration: write`
only). The single unavoidable secret is the App private key.

## One Org-Owned App Across Both Repos

A single GitHub App, owned by the `livestorejs` org and installed on both
`livestore` (core) and `livestore-contrib`, is the shared reconciliation
identity. Manifest, workflow, and drift-checks are authored once as shared
helpers; each repo carries its own `.github/repo-settings.json`. Core is
enrolled first; contrib enrolls by installing the same App and adding the
generated workflow.

| Option | Rejected because |
| ------ | ---------------- |
| One App per repo | Two private keys, two manifests kept in lockstep, duplicated provisioning runbook; contradicts the shared-helper model |
| Core-only, ignore contrib | Leaves contrib with the same silent-drift-wedges-releases bug; misses the near-zero-cost generalization the shared helpers already afford |

Blast radius of a shared App is bounded by least-privilege (`administration:
write` only) and short-lived per-run tokens. Cost is one org-level secret rather
than a per-repo secret.

## Define the App As-Code Via a Committed Manifest + Drift-Check

The App's definition is a committed [App Manifest](../.reference/github-app-platform-constraints.md)
(name, `default_permissions`, `default_events`, no webhook). A drift-check reads
the live App via `GET /app` and diffs it against the manifest — symmetric with
the existing ruleset drift-check.

| Option | Rejected because |
| ------ | ---------------- |
| Terraform for the App definition | Terraform's GitHub provider cannot define/create Apps; would only cover installation-scoping and add an external state backend for a sliver |
| Alchemy resource today | No `GitHub.App` resource exists yet ([alchemy-run/alchemy#843](https://github.com/alchemy-run/alchemy/issues/843)); revisit if/when it lands |
| Click-ops runbook only, no manifest | App definition becomes prose, not a machine-checkable artifact; drifts silently; contradicts the IaC goal |

GitHub gives no idempotent `apply` for App definitions (creation is a browser
manifest handshake; `default_permissions` cannot be updated via API — only in the
UI, forcing installation re-consent). So the manifest is **spec + verify**, not
**spec + converge**. The irreducible manual lifecycle (creation consent, private
key generation, installation, later permission edits) is fenced into an explicit
provisioning runbook in `context/`, keeping the non-IaC surface bounded and
documented rather than ambient.

## Reconcile-On-Merge Is the Authority; Drop the Hard Drift-Gate

A dedicated `repo-settings` workflow (sole holder of the App secret) applies the
desired ruleset on push to `main` path-filtered to `.github/repo-settings.json`,
plus a scheduled backstop for out-of-band console edits. PRs run a non-gating
dry-run plan. The former `ruleset-drift-check` job is removed from `ci.yml` — it
was never a required status check (absent from `requiredCIJobs`), so it never
blocked merges; it wedged releases only by setting the `ci` run conclusion to
`failure`, which `publish-snapshot-version` gates on.

| Option | Rejected because |
| ------ | ---------------- |
| Keep reconcile inside `ci.yml` (check-job → apply-job) | Puts the App admin secret in the broad `ci` workflow; re-couples reconcile to the ci critical path; a failed apply turns ci red → wedges releases again |
| Scheduled-only reconcile, keep the PR gate hard | Preserves the wedge: a merged-but-not-yet-applied change fails the next main run until cron catches up |

Live drift is now *reconciled by the merge*, not *policed before it*. This
removes the "governance check wedges releases" failure class structurally.
Decoupling snapshot publishing from the whole `ci` conclusion (so a governance
job can never gate a release) remains a separate, still-recommended change
tracked in [LS.DEL.REL-DQ2](../.delta/DELTA-001-snapshot-gated-on-ci-conclusion.md). A post-apply drift is a
real, alertable failure. Cost: a merged ruleset change is enforced on GitHub only
after the post-merge apply runs, not at merge instant.

## Deferred / Upstream

If `GitHub.App` lands in Alchemy (#843), the manifest-as-spec + custom
drift-check can be replaced by a real Alchemy resource with read/diff built in.
Until then, the manifest + drift-check is the maximally declarative option
within GitHub's platform limits.
