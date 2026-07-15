# DELTA-001 — Legacy intent surfaces not yet absorbed

The branch table in [spec.md](../spec.md) assigns ownership of all intent
content to branch nodes. Reality as of 2026-07-15 diverges:

- `contributor-docs/` holds operational guides (`package-release.md`,
  `release-workflows.md`, `dependency-management.md`,
  `wa-sqlite-management.md`, `changelog-guide.md`, `docs/*`) and the RFC
  process definition (`rfcs/index.md`) not yet migrated into their owning
  nodes (`03-delivery/`, `04-docs/`, `05-contributing/`). The delivery
  runbooks are referenced as pending companions in
  [03-delivery/spec.md](../03-delivery/spec.md).
- Docs pages (`why-livestore`, `when-livestore`, `design-decisions`,
  `concepts`) are canonical-in-practice; per LS-R15 they should derive from
  `01-product/`, `02-system/`, and [ontology.md](../ontology.md).
- `wip/` holds `2025-cf.md` and `upcoming-specs/store-commit-receipt.md`,
  which should become RFC proposals, node DQs, or roadmap entries.

Update this delta as surfaces migrate. Close it when every surface above is
absorbed into its owning node and the branch table matches reality.
