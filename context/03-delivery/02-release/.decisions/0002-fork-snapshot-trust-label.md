# 0002 — Trust labeled fork PR branches for snapshot publishing

Status: accepted

Evidence: [experiment 0001](../.experiments/0001-label-gated-fork-snapshots.md),
[experiment 0002](../.experiments/0002-pack-all-fork-candidates.md), and owner
design interview on 2026-08-18.

## Context

The repository-owned PR snapshot path could not serve fork PRs: fork pack jobs
were skipped, workflow-run PR associations were absent, and publication required
a merge-significant approval. PR #1558 demonstrated the gap. Maintainers need a
separate way to trust a contributor's mutable PR branch for test-only immutable
npm snapshots without granting merge approval or npm credentials.

## Evidence and Argument

Fork `pull_request` jobs receive a read-only token and no repository secrets.
The existing main-branch validator treats their artifacts as bounded untrusted
data and passed 11 adversarial tests. Live PR #1558 evidence showed that neither
the workflow run nor commit association APIs identify its PR, while exact head
repository, branch, and SHA do. A representative pack costs about 21 runner
minutes, which the owner accepted in exchange for the simpler single candidate
path.

## Options

| Option | Consequence |
| --- | --- |
| Package all PRs; label gates fork publication | One candidate path; spends packaging compute on unlabeled forks |
| Dedicated label-triggered fork pack workflow | Avoids unlabeled compute; adds another workflow/event topology |
| Keep forks excluded | Preserves the old boundary; fork snapshots remain unavailable |

## Decision

Package every PR head in the existing secretless candidate job. Preserve the
current-head review gate for repository-owned PRs. For forks, treat the
maintainer-managed `ci:publish-snapshot` label as a persistent, revocable trust
grant over the PR head repository and branch, including later commits while the
label remains. Resolve fork producers by exact repository, branch, and SHA;
validate artifacts without execution; and recheck the live label and unchanged
head immediately before npm OIDC publication.

Removing the label stops publication that has not started. It cannot retract an
immutable version already published to npm.
