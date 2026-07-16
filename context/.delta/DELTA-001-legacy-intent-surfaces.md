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

Regenerated as derived views (2026-07-16): `overview/why-livestore`,
`overview/when-livestore`, `overview/technology-comparison` (now covers all
three comparison categories; former 04-docs DELTA-002 closed),
`overview/concepts` (rendered from `ontology.md`), and
`misc/state-of-the-project` (derives from `01-product/` §Maturity &
Stability Promise + `03-delivery/02-release/` breaking-change mechanics).
The FAQ's community/funding claims were verified consistent with
`05-contributing/02-community/` and `06-sustainability/` (no regeneration
needed).

`understanding-livestore/design-decisions` was regenerated 2026-07-16 as a
derived page linking the founding decision records (decision-archaeology
pass).

Remaining divergence:

- **`wip/upcoming-specs/store-commit-receipt.md`** — stale proposal, kept
  (with status header) until the command/intent design session (LS-DQ1).

Update this delta as surfaces migrate. Close it when every surface above is
absorbed or regenerated and the branch table matches reality.
