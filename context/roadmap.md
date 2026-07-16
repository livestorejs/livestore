# LiveStore — Roadmap

Non-normative future direction. Entries constrain nothing until promoted into
requirements, spec, or a decision record.

- **UI component kit.** Open-source much of the devtools UI as a reusable
  component kit (stated 2026-07-15). Will concern `02-system/07-devtools/`
  and contrib packaging when it becomes concrete.

- **Additional read-model realizations.** State realizations beyond SQLite
  behind the same read-model contract (LS-R10), e.g. materializing into other
  storage or in-memory shapes.

- **Read/write model separation with N read models.** (sketched 2026-07-16)
  A proper write-model/read-model split allowing 0..n read models per store.
  Property sketch for the read-model trait set: sync vs async read models
  (sync: side-effect free, transactional, low-overhead — `store.commit`
  updates it in step so the UI stays current; async: catches up
  independently); every read model has a current cursor, its own error
  boundary, and must never block the write model; persistence spans
  leader ⇄ client session and supports efficient backwards catch-up; UI
  components exist to visualize read-model state/lag. Reshapes
  `02-system/02-state/` (contract) when promoted; also the frame in which
  cross-DB crash consistency gets decided (see `LS.SYS.STATE-DQ2`).

- **Legacy doc-surface dissolution.** Complete the migration of
  `contributor-docs/` operational guides and `wip/` content into their owning
  VRS nodes, per the branch table in [spec.md](./spec.md). Current drift is
  tracked in
  [.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md).
