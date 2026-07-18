# Delivery — Requirements

**Role:** Owns how LiveStore ships: repository/package composition, packaging,
release, versioning, and artifact flows. The product is delivered from two
repositories — `livestorejs/livestore` (core) and
`livestorejs/livestore-contrib` (contrib) — as one package family with a
mechanical ownership boundary. Refines root `LS-A04` (two-repo delivery) and
`LS-R16` (one product identity).

## Context

Builds on the root [requirements.md](../requirements.md). This node owns only
the delivery boundary; the mechanics live in the children:
[01-composition](./01-composition/requirements.md) (`LS.DEL.COMP-*`),
[02-release](./02-release/requirements.md) (`LS.DEL.REL-*`),
[03-artifacts](./03-artifacts/requirements.md) (`LS.DEL.ART-*`).
Former `LS.DEL-*` IDs were re-homed into the children on 2026-07-16; the
mapping notes live in each child's Context section. Operational sequencing is
tracked outside the VRS.

## Assumptions

- **LS.DEL-A01 Shared organization:** `livestorejs/livestore` and
  `livestorejs/livestore-contrib` live under the `livestorejs` GitHub
  organization and publish packages under the `@livestore` npm scope.

## Requirements

### Must Preserve User-Facing Package Identity

- **LS.DEL-R01 Package names unchanged:** Every package keeps its
  `@livestore/<name>` npm name regardless of source repository.
  `refines: LS-R16`
- **LS.DEL-R02 Import paths unchanged:** Moving source repositories does not
  require user code import changes. `refines: LS-R16`
