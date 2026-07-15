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

Two artifacts with distinct roles:

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

## Open Design Questions

- **LS.CONTRIB.COLLAB-DQ1 Review expectations.** Required approvals, reviewer
  assignment, and merge rights are not documented.
- **LS.CONTRIB.COLLAB-DQ2 Agent attribution convention.** How agent
  authorship is marked (commit trailer, PR label, or both) is not
  standardized in repo docs.
