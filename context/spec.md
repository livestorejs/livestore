# LiveStore Intent Layer — Spec

This document specifies the composition of the LiveStore intent layer (VRS
tree): its branches, conventions, and cross-branch rules. It builds on
[requirements.md](./requirements.md). Subsystem contracts live in the branch
nodes, not here.

## Status

Draft.

## Scope

Defines: the branch structure, node conventions, ID scheme, maturity markers,
and precedence rules across intent surfaces.

Does not define: product positioning (`01-product/`), system contracts
(`02-system/`), delivery (`03-delivery/`), documentation (`04-docs/`),
contribution process (`05-contributing/`), or sustainability
(`06-sustainability/`) — see the branch nodes.

## Branch Architecture

```
context/                     root: LiveStore the product (this node)
  01-product/                positioning, use-case fit, comparisons, when-not
  02-system/                 the technical system
    01-event-model/          event defs, LiveStoreEvent, sequence numbers,
                             eventlog, facts (experimental)
    02-state/                read-model contract; realizations as children
      01-sqlite/             SQLite schema DSL, materializers, client
                             documents, query builder, schema management
    03-sync/                 syncstate machine, push/pull/rebase semantics,
                             sync-provider contract; provider realizations
    04-runtime/              leader ⇄ client-session topology, adapter
                             contract + realizations, transport (webmesh),
                             persistence substrate (SQLite builds)
    05-store/                app-facing Store, reactivity graph, live
                             queries, signals, multi-store/StoreRegistry
    06-observability/        OTel instrumentation contract, telemetry
                             semantics, debug surfaces
    07-devtools/             devtools protocol + surfaces contract
    08-integrations/         framework-integration contract + realizations
    09-verification/         test architecture, conformance suites for
                             pluggable dimensions, benchmarks
  03-delivery/               repo/package composition, packaging, release,
                             versioning, artifact flows
  04-docs/                   docs-site derivation rules, snippets/diagrams
                             policy
    01-examples/             example apps as learning surface + test fixtures
  05-contributing/           RFC process + fold-in rule, governance
    01-collaboration/        day-to-day human/agent collaboration model
  06-sustainability/         licensing, sponsorship, commercial surfaces
```

Numeric prefixes encode dependency direction within a level: a higher-numbered
node may depend on lower-numbered siblings, never the reverse. Order across
kinds (e.g. `04-docs/` vs `05-contributing/`) is reading order only.

### Branch responsibilities

| Branch | Owns | Absorbs (over time) |
| --- | --- | --- |
| `01-product/` | Positioning, target use cases, comparison criteria, adoption guidance | `docs/overview/why-livestore`, `when-livestore` (as canonical source; docs pages become derived) |
| `02-system/` | All technical contracts and their realizations | `docs/understanding-livestore/design-decisions` content, RFC fold-ins |
| `03-delivery/` | Repo topology, package composition, release/versioning, artifact flows | `context/repo-architecture/`, `context/devtools-artifact-release/`, `contributor-docs/{package-release,release-workflows,dependency-management,wa-sqlite-management}` |
| `04-docs/` | Derivation rule (docs follow VRS), snippets/diagrams policy, examples as learning surface | `contributor-docs/docs/*`, examples policy |
| `05-contributing/` | Collaboration model, RFC process + fold-in rule, governance, community surfaces | `contributor-docs/rfcs/index.md`, `CONTRIBUTING.md` (as canonical source) |
| `06-sustainability/` | License policy, sponsorship/funding model, commercial surfaces | `docs/sustainable-open-source/*` (as canonical source) |

## Node Conventions

- Nodes follow the meta-VRS node shape; all artifacts are lazy.
- `vision.md` exists at the root only. A branch or child node states its role
  in 1–3 sentences atop its `requirements.md`.
- **Plugin dimensions** (read models, sync providers, adapters, framework
  integrations, devtools surfaces) use the composable contract/realization
  pattern: the dimension node states the mechanism-agnostic contract once;
  each realization is a child node whose requirements declare
  `refines: <parent-id>`. Contrib-owned realizations get a contract-level stub
  child here; their implementation specs live in `livestore-contrib`.
- Child requirements that constrain a parent concept declare `refines:` with
  the parent ID so the tree reads upward.

## ID Scheme

All IDs carry the uniform `LS` prefix so they are globally unique when quoted
outside the repo (assumptions `A`, tradeoffs `T`, requirements `R`, design
questions `DQ`, deltas `DELTA`, decisions by number):

| Namespace | Node |
| --- | --- |
| `LS-*` | root |
| `LS.PROD-*` | `01-product/` |
| `LS.SYS-*` | `02-system/` |
| `LS.SYS.EVT-*` | `02-system/01-event-model/` |
| `LS.SYS.STATE-*` / `LS.SYS.STATE.SQLITE-*` | `02-system/02-state/` and realization |
| `LS.SYS.SYNC-*` / `LS.SYS.SYNC.CF-*` | `02-system/03-sync/` and realizations |
| `LS.SYS.RT-*` / `LS.SYS.RT.WEB-*`, `LS.SYS.RT.CF-*` | `02-system/04-runtime/` and adapter realizations |
| `LS.SYS.STORE-*` | `02-system/05-store/` |
| `LS.SYS.OBS-*` | `02-system/06-observability/` |
| `LS.SYS.DT-*` | `02-system/07-devtools/` |
| `LS.SYS.INT-*` / `LS.SYS.INT.REACT-*` | `02-system/08-integrations/` and realizations |
| `LS.SYS.VER-*` | `02-system/09-verification/` |
| `LS.DEL-*` | `03-delivery/` |
| `LS.DOCS-*` / `LS.DOCS.EX-*` | `04-docs/` and `01-examples/` |
| `LS.CONTRIB-*` / `LS.CONTRIB.COLLAB-*` | `05-contributing/` and `01-collaboration/` |
| `LS.SUST-*` | `06-sustainability/` |

Realization namespaces extend their dimension namespace with one more segment.
IDs are sequential per namespace; renumbering updates all references in the
same commit.

## Maturity Markers

The intent layer must keep shipping reality and design-stage material
unmistakably distinct:

- Every `spec.md` carries a `## Status` (`Draft` / `Active` / `Stable`).
- Sections describing non-shipping behavior open with a bold marker:
  `**Maturity: experimental**` (code exists behind an experimental flag, e.g.
  facts, `sync/next/`) or `**Maturity: proposal**` with a link to the owning
  RFC (no code, e.g. command replay → RFC 0002).
- Unmarked spec content describes shipping behavior.

## Precedence Across Intent Surfaces

Per [decision 0002](./.decisions/0002-single-intent-layer.md):

- This VRS tree is the only always-current intent layer (LS-R15).
- **RFCs** (`contributor-docs/rfcs/`) are the proposal pipeline. On
  acceptance, durable content folds into the owning nodes (requirements/spec
  clauses; choices + rejected alternatives as `.decisions/` records citing the
  RFC); the RFC becomes a historical record. The fold-in rule is owned by
  `05-contributing/`.
- **Docs site** (`docs/`) teaches users; it derives from VRS and never defines
  contracts. `ontology.md` is the canonical term source; divergence in docs is
  a docs bug.
- **`contributor-docs/`** operational guides migrate into their owning nodes
  as those nodes are written (see branch table); step-by-step runbooks may
  remain as companion files under the owning node.
- **`wip/`** dissolves: entries become RFC proposals, node DQs, or roadmap
  items; no new content.

Current divergence from this contract is tracked in
[.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md).

## Open Design Questions

- **LS-DQ1 Command/intent design placement.** RFC 0002 (command replay) stays
  an active proposal for now; whether it becomes a dedicated design-stage node
  in `02-system/` or folds into event-model + sync on acceptance is
  unresolved. See [open-questions.md](./open-questions.md).
- **LS-DQ2 Contrib-repo referencing mechanics.** How `livestore-contrib`
  nodes reference and refine this tree (stub shape, ID allocation, link
  direction) is unresolved until the first contrib realization stub is
  written.
