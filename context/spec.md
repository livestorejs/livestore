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
                             documents, query builder
        02-schema-management/  hash-based rebuild, auto/manual migration
                               strategies, storage-format versioning
    03-sync/                 sync-provider contract (boundary)
      01-syncstate/          pure merge core: outcomes, invariants,
                             rebase generations, client-only events
      02-processors/         leader/session processors: queues, batching,
                             retry, pull precedence, cursors
      03-cf/                 Cloudflare provider realization
    04-runtime/              leader ⇄ client-session topology, adapter
                             contract + realizations, proxy contract,
                             persistence substrate (SQLite builds)
      01-web/                browser realization
        01-persistence/  02-topology/  03-leadership/
      02-cloudflare/         Durable Object realization
      03-webmesh/            transport: channel kinds, edges, ack semantics
    05-store/                app-facing Store, commit path, lifecycle,
                             multi-store/StoreRegistry
      01-reactivity/         reactive graph, live-query kinds, dedup and
                             caching layers
    06-observability/        OTel instrumentation contract, telemetry
                             semantics, debug surfaces
    07-devtools/             devtools protocol + surfaces contract
    08-integrations/         framework-integration contract + realizations
      01-react/  02-effect/  realizations (hooks; Store.Tag layer API)
    09-verification/         verification contract
      01-lanes/  02-conformance/  03-performance/  04-protocol-compat/
      05-determinism/
  03-delivery/               delivery identity boundary
    01-composition/          repo/package composition, locks, tooling, docs
    02-release/              versioning, publish flow, dependency policy
    03-artifacts/            devtools artifact contract, wa-sqlite vendoring
  04-docs/                   docs-site derivation rules, snippets/diagrams
                             policy
    01-examples/             example apps as learning surface + test fixtures
    02-search/               docs search UX + index freshness
    03-operations/           deploy contract, agent/markdown surface, docs
                             testing
  05-contributing/           RFC process + fold-in rule, governance, security
    01-collaboration/        day-to-day human/agent collaboration model
    02-community/            public community surfaces + support expectations
  06-sustainability/         licensing, sponsorship, commercial surfaces,
                             brand
```

Numeric prefixes encode dependency direction within a level: a higher-numbered
node may depend on lower-numbered siblings, never the reverse. Order across
kinds (e.g. `04-docs/` vs `05-contributing/`) is reading order only.

### Branch responsibilities

| Branch | Owns | Absorbs (over time) |
| --- | --- | --- |
| `01-product/` | Positioning, target use cases, comparison criteria, adoption guidance | `docs/overview/why-livestore`, `when-livestore` (as canonical source; docs pages become derived) |
| `02-system/` | All technical contracts and their realizations | `docs/understanding-livestore/design-decisions` (absorbed 2026-07-16 into `.decisions/` records; page is now derived), RFC fold-ins |
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
- Child requirements that constrain a parent concept declare a backticked
  `` `refines: <parent-ids>` `` marker at the end of the requirement bullet
  so the tree reads upward.

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
| `LS.SYS.STATE-*` / `LS.SYS.STATE.SQLITE-*`, `LS.SYS.STATE.SQLITE.SM-*` | `02-system/02-state/` and children |
| `LS.SYS.SYNC-*` / `LS.SYS.SYNC.SS-*`, `LS.SYS.SYNC.PROC-*`, `LS.SYS.SYNC.CF-*` | `02-system/03-sync/` and children |
| `LS.SYS.RT-*` / `LS.SYS.RT.WEB-*`, `LS.SYS.RT.CF-*`, `LS.SYS.RT.MESH-*`, `LS.SYS.RT.WEB.PERSIST-*`, `LS.SYS.RT.WEB.TOPO-*`, `LS.SYS.RT.WEB.LEAD-*` | `02-system/04-runtime/` and children |
| `LS.SYS.STORE-*` / `LS.SYS.STORE.RX-*` | `02-system/05-store/` and children |
| `LS.SYS.OBS-*` | `02-system/06-observability/` |
| `LS.SYS.DT-*` | `02-system/07-devtools/` |
| `LS.SYS.INT-*` / `LS.SYS.INT.REACT-*`, `LS.SYS.INT.EFFECT-*` | `02-system/08-integrations/` and realizations |
| `LS.SYS.VER-*` / `LS.SYS.VER.LANE-*`, `LS.SYS.VER.CONF-*`, `LS.SYS.VER.PERF-*`, `LS.SYS.VER.PROTO-*`, `LS.SYS.VER.DET-*` | `02-system/09-verification/` and children |
| `LS.DEL-*` / `LS.DEL.COMP-*`, `LS.DEL.REL-*`, `LS.DEL.ART-*` | `03-delivery/` and children |
| `LS.DOCS-*` / `LS.DOCS.EX-*`, `LS.DOCS.SEARCH-*`, `LS.DOCS.OPS-*` | `04-docs/` and children |
| `LS.CONTRIB-*` / `LS.CONTRIB.COLLAB-*`, `LS.CONTRIB.COMM-*` | `05-contributing/` and children |
| `LS.SUST-*` | `06-sustainability/` |

Realization namespaces extend their dimension namespace with one more segment.
IDs are sequential per namespace; renumbering updates all references in the
same commit.

## Maturity Markers

The intent layer must keep shipping reality and design-stage material
unmistakably distinct:

- Every `spec.md` carries a `## Status` (`Draft` / `Active` / `Stable`).
- Sections describing non-shipping behavior that **has code** open with a bold
  `**Maturity: experimental**` marker (code exists behind an experimental flag,
  e.g. facts, `sync/next/`).
- Unmarked spec content describes shipping behavior.
- **No-code proposals do not appear as spec content.** A design with no code
  (typically an open RFC) is never written into a `spec.md`, `requirements.md`,
  or `ontology.md` body; it surfaces only as an open question that points to the
  owning RFC, keeping the RFC the single source of truth for its own proposal
  until acceptance folds it in (see Precedence Across Intent Surfaces, and
  [decision 0004](./.decisions/0004-rfc-vrs-boundary.md)). This keeps the tree
  describing the system that exists.

## Evidence Conventions

- **Decision provenance.** A decision record cites its decisive evidence in
  or directly below its Status line: experiment path, prototype, benchmark,
  or user confirmation with date. Records without evidence stay proposed.
- **Rename mapping.** When a canonical term or ID is renamed, the rename is
  recorded in `.decisions/mapping.md` (created on first rename) so
  `ontology.md` and requirements stay timeless while history remains
  traceable.
- **External assumptions.** Platform guarantees the contracts depend on
  (e.g. Cloudflare Durable Object storage durability) are captured as
  `.reference/` records and cited from the requirement or DQ that depends on
  them.

## Precedence Across Intent Surfaces

Per [decision 0002](./.decisions/0002-single-intent-layer.md):

- This VRS tree is the only always-current intent layer (LS-R15).
- **RFCs** (`contributor-docs/rfcs/`) are the proposal pipeline. While an RFC
  is unaccepted, its design and coined terms live **only** in the RFC; the
  tree's entire footprint is (1) the real limitation the RFC addresses, stated
  on the affected node where that limitation is a true property of the shipping
  system, and (2) a pointer to the RFC from an open question — root `LS-DQ1` is
  the anchor, node `DQ`s cross-reference it rather than each holding their own
  RFC pointer. On acceptance, durable content folds into the owning nodes
  (requirements/spec clauses; choices + rejected alternatives as `.decisions/`
  records citing the RFC), coined terms enter `ontology.md`, and the RFC becomes
  a historical record. The fold-in rule and this pre-acceptance footprint rule
  ([decision 0004](./.decisions/0004-rfc-vrs-boundary.md)) are owned by
  `05-contributing/`.
- **Docs site** (`docs/`) teaches users; it derives from VRS and never defines
  contracts. `ontology.md` is the canonical term source; divergence in docs is
  a docs bug.
- **`contributor-docs/`** operational guides migrate into their owning nodes
  as those nodes are written (see branch table); step-by-step runbooks may
  remain as companion files under the owning node.
- **`wip/`** is dissolved (removed 2026-07-16): design uncertainty lives in
  node/root `DQ`s, proposals in RFCs, and future direction in `roadmap.md`; no
  such staging area exists.

Divergence from this contract is tracked in
[.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md)
(the original absorption pass and the #1424 ruleset-sync absorption are complete;
one follow-up remains — folding contrib label reconciliation into that
apparatus).

## Enforcement

The mechanical invariants of this document are checked by a Vitest suite at
`tests/package-common/src/intent-layer/intent-layer.test.ts` (`mono test unit`
locally, and in the CI `test-unit` job). It checks: ID uniqueness, ID namespace
↔ directory mapping (parsed from the ID Scheme table above), `refines:` target
resolution, relative-link integrity, spec `Status` headers, absence of empty
companion dirs, decision-record shape (`NNNN-slug.md`, `Status:` line, no
committed `.proposed/`), and the maturity vocabulary (only `experimental` is a
legal marker; `proposal` is rejected — see Maturity Markers). Semantic review
(testability, decision evidence quality) remains human/agent judgment.

The suite runs in CI but its failures do **not yet hard-block the run**:
`tests/package-common` sits in the CI runner's `sequentialPackages` group, which
is executed through `Effect.ignore` (a workaround for flaky `webmesh` tests,
`scripts/src/commands/test-commands.ts`), so a failing invariant is logged, not
gated. Making this suite fail the `test-unit` job — by running it as a dedicated
non-ignored step — is tracked in
[.delta/DELTA-002-enforcement-not-ci-blocking.md](./.delta/DELTA-002-enforcement-not-ci-blocking.md).

## Open Design Questions

- **LS-DQ1 Command/intent design** — RFC 0002 (command replay) is an open
  proposal whose design lives in the RFC per
  [decision 0004](./.decisions/0004-rfc-vrs-boundary.md); the open part is
  whether to accept and fold it in. See
  [open-questions.md](./open-questions.md).

(LS-DQ2 was resolved 2026-07-16 into
[.decisions/0003-contrib-referencing.md](./.decisions/0003-contrib-referencing.md).)
