# Docs Search — Requirements

Role: owns the docs search experience — index freshness and the search UX
contract. Search *infrastructure* placement (one index across core and
contrib docs) is owned by delivery composition
([LS.DEL.COMP-R14](../../03-delivery/01-composition/requirements.md)); this
node owns what that index must deliver to readers.

## Context

Builds on [../requirements.md](../requirements.md). Grounded in the
Mixedbread vector-store sync (`.github/workflows/sync-docs.yml`) and the
production search sync in the release flow
(`../../03-delivery/02-release/release-workflows-runbook.md`).

## Requirements

- **LS.DOCS.SEARCH-R01 Index freshness:** The docs search index is updated
  on every docs push (dev index) and on every stable release (production
  index); search never serves content older than the latest stable docs.
  Adopted 2026-07-16 (interview).
- **LS.DOCS.SEARCH-R02 One index, whole product:** Search spans core and
  contrib package docs as one result set. `refines: LS.DEL.COMP-R14`
  Adopted 2026-07-16 (interview).
