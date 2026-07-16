# DELTA-001 — Legacy intent surfaces not yet absorbed

Status: open (narrowed 2026-07-16)

The branch table in [spec.md](../spec.md) assigns ownership of all intent
content to branch nodes. Absorbed so far: the four delivery runbooks (moved
under `03-delivery/{02-release,03-artifacts}/`), the RFC process fold-in
step (`contributor-docs/rfcs/index.md` §4), ownership headers on
`events-notation.md`, `changelog-guide.md`, and `examples-cloudflare.md`
(files stay in place, owned by their nodes), and `wip/2025-cf.md` (deleted
2026-07-16 — durable rationale captured as
`02-system/03-sync/03-cf/.decisions/0001` and
`02-system/04-runtime/02-cloudflare/.decisions/0001` plus a roadmap entry;
bug notes handled via issue filing).

Remaining divergence:

- **Canonical-in-practice docs pages** pending regeneration as derived
  views: `overview/why-livestore`, `overview/when-livestore`,
  `overview/technology-comparison` (see
  [04-docs/.delta/DELTA-002](../04-docs/.delta/DELTA-002-derived-surface-rot.md)),
  `understanding-livestore/design-decisions`, `overview/concepts` (ontology
  rendering), `misc/state-of-the-project` (derives from `01-product/`
  §Maturity & Stability Promise), and the FAQ's community/funding claims
  (derive from `05-contributing/02-community/` and `06-sustainability/`).
- **`wip/upcoming-specs/store-commit-receipt.md`** — stale proposal, kept
  (with status header) until the command/intent design session (LS-DQ1).

Update this delta as surfaces migrate. Close it when every surface above is
absorbed or regenerated and the branch table matches reality.
