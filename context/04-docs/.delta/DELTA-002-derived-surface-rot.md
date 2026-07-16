# DELTA-002 — Derived docs pages diverge from their source nodes

Status: open

## Divergence

Two overview pages fail the derivation contract (LS.DOCS-R01,
LS.PROD-R07):

- `docs/src/content/docs/overview/technology-comparison.md` covers only the
  state-management category (Redux + a bullet list); LS.PROD-R04 mandates
  all three comparison categories (state management, BaaS, local-first sync
  for existing DBs), which `why-livestore.mdx` does cover.
- `docs/src/content/docs/overview/when-livestore.md` contains a trailing
  placeholder ("e.g. productivity apps like" with no continuation).

## VRS

[../../01-product/requirements.md](../../01-product/requirements.md)
LS.PROD-R04/R07; [../requirements.md](../requirements.md) LS.DOCS-R01.

## Implementation Contract

Regenerate both pages from `01-product/spec.md` (comparison stance table,
fit matrix). Close this delta when technology-comparison covers all three
categories and the placeholder sentence is resolved.
