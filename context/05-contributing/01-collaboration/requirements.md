# Collaboration — Requirements

Role: owns the day-to-day collaboration mechanics for humans and AI agents
working on the repo — branching, gates, changelog discipline, and PR
conventions.

## Context

Builds on [../requirements.md](../requirements.md). Grounded in the repo
conventions (`CLAUDE.md`/`AGENTS.md`) and
`contributor-docs/changelog-guide.md`.

## Requirements

- **LS.CONTRIB.COLLAB-R01 Branch naming:** Branches are named
  `<username>/<kind>/<short-desc>` in kebab-case (e.g.
  `jane/fix/memory-leak`).
- **LS.CONTRIB.COLLAB-R02 Green gates before commit:** Changes pass lint and
  type checks before commit (`dt lint:full:fix`, `dt ts:check`); the full
  test suite passes before push (`dt test:run`).
- **LS.CONTRIB.COLLAB-R03 Changelog discipline:** Every user-facing change
  lands in the upcoming section of `CHANGELOG.md`; each user-facing bullet
  links at least one GitHub issue or PR; no placeholder links.
  `refines: LS.CONTRIB-R05`
- **LS.CONTRIB.COLLAB-R04 PR framing:** PR titles and bodies state problem,
  approach, and validation; title and description track scope as it evolves.
- **LS.CONTRIB.COLLAB-R05 Agent parity:** Agent-authored changes are
  attributed as such and pass the same gates as human changes.
