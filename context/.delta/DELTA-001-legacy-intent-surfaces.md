# DELTA-001 — Legacy intent surfaces not yet absorbed

Status: open (reopened 2026-07-16) — the surfaces below were all absorbed or
regenerated and `wip/` dissolved, but an inbound legacy surface from
livestorejs/livestore#1424 remains to absorb (see Pending). Was briefly closed
after the command/intent design session.

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

Resolved 2026-07-16 (command/intent design session):

- **`wip/upcoming-specs/store-commit-receipt.md`** — deleted. A no-code
  proposal living outside both the RFC pipeline and the tree; under
  [decision 0004](../.decisions/0004-rfc-vrs-boundary.md) such a proposal
  belongs in an RFC. The store's commit-confirmation surface is now tracked by
  `LS.SYS.STORE-DQ1` (gated by root LS-DQ1). `wip/` is removed.

## Pending (inbound)

- **`context/repo-ruleset-sync/`** — a flat, pre-hierarchy VRS added by
  livestorejs/livestore#1424 (branch-ruleset auto-reconcile). **Absorb** into
  `03-delivery/02-release/`: (1) the ruleset auto-reconcile design (org-owned
  GitHub App defined as-code + `GET /app` drift-check; apply-on-merge +
  scheduled backstop + non-gating PR dry-run; `ruleset-drift-check` job removed)
  as a decision record + spec section under a new `LS.DEL.REL.*` namespace, and
  (2) a requirement + `.delta` that snapshot publishing must not gate on the
  whole `ci` run conclusion. Sequenced **after #1424 merges** — its `spec.md`
  uses a blockquote status, so it intentionally fails the intent-layer
  enforcement suite as a forcing function. **Absorb, do not conform-in-place;
  do not delete without capturing.** Source and full spec: #1424
  `context/repo-ruleset-sync/open-questions.md` OQ4 and the #1406 PR comment.
- **Contrib GitHub labels reconciliation.** `livestorejs/livestore-contrib`'s
  labels are unmanaged (stock GitHub defaults vs the 28-label
  `.github/labels.json` manifest). Decided 2026-07-17 (interview): reconcile
  them through the **same** org GitHub-App apparatus #1424 builds for
  `repo-settings.json` — not a one-off manual `gh label` sync — so one mechanism
  owns all `.github/` desired-state. Fold `labels.json` into that reconciliation
  scope when the ruleset design is absorbed into `03-delivery/02-release/`.
