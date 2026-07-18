# 0001 — Root the product VRS at `context/`, product-scoped

Status: accepted (2026-07-15, design interview with schickling).

## Context

The repository had two topic-scoped VRS roots — `context/repo-architecture/`
and `context/devtools-artifact-release/` — and no product-level intent layer.
LiveStore ships from two repositories (`livestorejs/livestore` core,
`livestorejs/livestore-contrib`) under one product identity, so the product
is larger than either repository.

## Options

### Root location

- **(a) `context/livestore/` sibling root.** Keeps `context/` a flat
  namespace of per-topic VRS roots. Rejected: `livestore/livestore` stutter
  inside the product's own repo, and no single canonical tree — meta topics
  stay unowned peers.
- **(b) Root directly at `context/`** — chosen. The repo is the product's
  home, so the product tree is the root; existing topic roots become branch
  nodes (repo topology and artifact flows belong to `03-delivery/`).
  Tradeoff: non-product topics must fit the branch structure.
- **(c) Docs-site integration (`docs/`).** Rejected: mixes the normative
  intent layer with user-facing narrative teaching and couples it to the docs
  build.

### Scope

- **Repo-scoped.** Rejected: cross-repo contracts (sync protocol, adapter
  contract, devtools protocol) would have no single home — the drift problem
  the two-repo split already warns about.
- **Product-scoped** — chosen. `context/` describes LiveStore the product;
  contrib-owned surfaces participate at the contract level, with
  implementation specs living in `livestore-contrib`.

## Evidence

User confirmation in the 2026-07-15 design interview (Q1: option B, Q2:
option A).

## Consequences

- `context/repo-architecture/` and `context/devtools-artifact-release/`
  migrate into `03-delivery/`; drift until then is tracked in
  [DELTA-001](../.delta/DELTA-001-legacy-intent-surfaces.md).
- The intent layer, including `.decisions/`, is fully public in this
  repository.
