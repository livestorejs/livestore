# LiveStore — Roadmap

Non-normative future direction. Entries constrain nothing until promoted into
requirements, spec, or a decision record.

- **UI component kit.** Open-source much of the devtools UI as a reusable
  component kit (stated 2026-07-15). Will concern `02-system/07-devtools/`
  and contrib packaging when it becomes concrete.

- **Additional read-model realizations.** State realizations beyond SQLite
  behind the same read-model contract (LS-R10), e.g. materializing into other
  storage or in-memory shapes.

- **Legacy doc-surface dissolution.** Complete the migration of
  `contributor-docs/` operational guides and `wip/` content into their owning
  VRS nodes, per the branch table in [spec.md](./spec.md). Current drift is
  tracked in
  [.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md).
