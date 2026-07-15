# Product — Requirements

Role: owns LiveStore's positioning, use-case fit, comparison stance, and
adoption guidance. Root [vision.md](../vision.md) owns goals and anti-goals;
this node owns how fit and positioning are communicated and kept honest.

## Context

Builds on the root [requirements.md](../requirements.md). The docs pages
`overview/why-livestore`, `overview/when-livestore`, and
`overview/technology-comparison` are derived views of this node (LS-R15).

## Requirements

### Fit guidance must be honest and complete

- **LS.PROD-R01 Non-fit criteria:** Product guidance always names the cases
  LiveStore is not built for: an existing database as source of truth, highly
  connected cross-user data (social networks, marketplaces), expectations of
  a batteries-included full stack (auth, storage), bundle-size-critical apps,
  and developers new to the underlying problems.
- **LS.PROD-R02 Target use cases:** Guidance names the primary fit:
  high-performance productivity apps across web/desktop/mobile, AI agents,
  and apps needing solid offline support or audit logs.
- **LS.PROD-R03 Scale envelope:** Guidance states the operating envelope —
  client-sized data per store and small/medium write concurrency per
  eventlog, scaled horizontally across stores. `refines: LS-A01, LS-A02`

### Positioning must be category-accurate

- **LS.PROD-R04 Comparison categories:** Comparisons position LiveStore
  against three categories with factual differentiators: state-management
  libraries (no persistence/sync), backend-as-a-service (server as source of
  truth), and local-first sync layers for existing databases (serve the
  existing-DB case LiveStore excludes).
- **LS.PROD-R05 Differentiator claims:** The stated differentiators — 
  reactive in-memory + persisted SQLite with synchronous queries, event
  sourcing, client-centric with first-class devtools — stay consistent with
  the system contracts in `02-system/`.

### Adoption guidance

- **LS.PROD-R06 Evaluation exercise:** The primary fit test offered to
  adopters is modeling their app's events (and optionally state) — kept
  current with the shipping schema API.
- **LS.PROD-R07 Derived docs:** The overview docs pages derive from this node
  and must not contradict it. `refines: LS-R15`
