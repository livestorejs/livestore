# Collaboration — Spec

This document specifies day-to-day collaboration mechanics. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Change Flow

```
branch ──► changes + changeset ──► lint/type gates ──► PR (problem/approach)
      ──► review ──► merge (changelog upcoming section updated)
```

- Branch per LS.CONTRIB.COLLAB-R01; changeset per LS.CONTRIB-R05
  (`pnpm exec changeset`, `--empty` when no release-note impact).
- Gates: `dt lint:full:fix` then `dt ts:check` before commit; `dt test:run`
  before push (LS.CONTRIB.COLLAB-R02).
- PR body follows the repo template: problem, solution, validation,
  trade-offs, linked issues; evidence (logs, screenshots, diagrams)
  encouraged.

## Changelog Model (LS.CONTRIB.COLLAB-R03)

Companion runbook:
[`contributor-docs/changelog-guide.md`](../../../contributor-docs/changelog-guide.md)
(owned by this node). Two artifacts with distinct roles:

- **Changesets** — per-PR release ledger and semver signal.
- **`CHANGELOG.md`** — editorial narrative; upcoming section at top, folded
  from changesets as changes land.

Release-section layout: Highlights (3–5 bullets) → Breaking Changes (with
migration guidance) → Changes (grouped by user-facing area: platform
adapters, sync providers, core, tooling, docs) → maintainer-oriented notes.
External contributors are credited with `@<username>`. Sealed sections stay
immutable apart from editorial fixes.

## Communication Surfaces

- Discord: pre-coordination (`#contrib`), community help.
- GitHub: issues (minimal repros; `help wanted` label), PRs, RFC review.

Public community surfaces (office hours, contributor sync, support
expectations) are owned by [../02-community/](../02-community/spec.md).

## Templates and Labels (LS.CONTRIB.COLLAB-R06)

`.github/ISSUE_TEMPLATE/bug_report.yml` enforces the minimal-repro rule
(LS.CONTRIB-R06); `.github/pull_request_template.md` enforces PR framing
(LS.CONTRIB.COLLAB-R04); the label taxonomy (`bug`, `help wanted`, `docs`,
`adapter:*`, `integration:*`, `syncing:*`, …) carries the routing the scope
tiers assume. Template or taxonomy changes are reviewed against the
contributing requirements they realize.

## Review and Merge

Current practice (captured 2026-07-15): merges are maintainer-led under the
project's BDFL governance (see [../spec.md](../spec.md)); there is no
required-approval count. External PRs are reviewed by a maintainer before
merge. Contributor-side tooling conventions (which accounts or automation a
contributor uses to author changes) are the contributor's own concern and out
of scope for this layer; repo-level agent conventions live in `CLAUDE.md` and
`AGENTS.md`.
