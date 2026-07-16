# 0002 — RFCs propose, VRS is settled intent, docs derive

Status: accepted (2026-07-15, design interview with schickling).

## Context

Four surfaces carry intent in this repository: the VRS tree (`context/`),
RFCs (`contributor-docs/rfcs/`), the docs site (`docs/`), and operational
guides (`contributor-docs/`, `wip/`). Without a precedence rule they drift
into competing sources of truth.

## Options

### RFC relationship

- **(a) RFCs are the proposal pipeline; VRS is settled intent** — chosen.
  RFCs remain the community-facing process for proposing consequential
  changes. On acceptance, durable content folds into the owning VRS nodes —
  requirements/spec clauses for the contract, decision records for the choice
  and its rejected alternatives, citing the RFC — and the RFC becomes a
  historical record that is never updated to track reality. Tradeoff: fold-in
  is double bookkeeping and needs an enforced rule.
- **(b) Retire RFCs; use `.decisions/.proposed/` + open questions.**
  Rejected: proposed records are PR-local by contract — the wrong shape for
  long-lived public discussion — and external contributors lose a familiar
  convention.
- **(c) Peer systems with informal cross-links.** Rejected: guarantees the
  drift and precedence ambiguity this decision exists to eliminate.

### Docs and operational guides

- **VRS canonical; other surfaces are derived views** — chosen. The docs site
  teaches users and derives from VRS; `ontology.md` is the canonical term
  source and divergence in docs is a docs bug. `contributor-docs/` guides
  migrate into their owning nodes as those nodes are written; step-by-step
  runbooks may remain as companion files under the owning node. `wip/`
  dissolves into RFC proposals, node DQs, or roadmap entries.
- **Permanent split ownership** (contributor-docs stays a peer layer).
  Rejected: contract ownership split forever between two trees.
- **Partially normative docs site.** Rejected: reintroduces two intent
  layers, same failure as (c) above.

## Evidence

User confirmation in the 2026-07-15 design interview (Q7: option A, Q8:
option A).

## Consequences

- The fold-in rule is owned by `05-contributing/` (which also absorbs
  `contributor-docs/rfcs/index.md`).
- RFC 0001 (multi-store API, largely shipped) is a fold-in candidate.
- RFC 0002 (command replay) stays an active proposal, tracked by LS-DQ1 in
  [open-questions.md](../open-questions.md). How proposals relate to the tree
  before acceptance is set by
  [decision 0004](./0004-rfc-vrs-boundary.md).
- Enforced by root requirement LS-R15.
