# DELTA-001 — Docs/examples CI gates are optional

Status: open

## Divergence

LS.DOCS-R04 (snippets that no longer compile fail CI) and LS.DOCS.EX-R02
(broken examples fail CI) promise required gates. Reality: the snippet and
example builds run in CI and turn their jobs red, but PR #1391 removed the
docs/examples build+deploy jobs from the repo's required status checks
(`.github/repo-settings.json` `required_status_checks` lists only
source-policy, lint, changeset-check, type-check, test-unit, and the
integration lanes). A PR with broken snippets or examples can merge. The
one exception: the `test-integration-playwright (todomvc)` required check
does gate that example's E2E.

## VRS

[requirements.md](../requirements.md) LS.DOCS-R04;
[01-examples/requirements.md](../01-examples/requirements.md)
LS.DOCS.EX-R02. Kept as required-gate promises per the 2026-07-16
interview (Q27d).

## Implementation Contract

Restore a required gate — plausibly snippets-only (fast, deterministic;
`mono docs snippets build`) while example preview deploys stay optional
(#1391's flakiness tradeoff). Close this delta when a broken snippet blocks
merge again.
