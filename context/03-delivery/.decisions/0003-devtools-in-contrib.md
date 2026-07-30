# 0003 — Retire the DevTools artifact handoff; build DevTools from contrib source

Status: accepted

Supersedes: 0002-devtools-artifact-cadence

Decided: 2026-07-30, design interview with schickling, on the evidence below.

## Context

`@livestore/devtools-vite` was maintained in a private upstream repository and
shipped to npm as a prebuilt artifact: the upstream repo built a sanitized
tarball, published it to a public handoff repo, and core pinned it by URL and
`sha256` in `release/devtools-artifact.json`, republishing it under the
`@livestore/devtools-vite` name.

[0002-devtools-artifact-cadence](0002-devtools-artifact-cadence.md) decided how
to certify that artifact against a LiveStore release. Its Context opens
"LiveStore releases consume a prebuilt DevTools artifact produced from `overeng`
source". **That sentence stops being true**, which is why this record supersedes
`0002` rather than amending it, per the rule in
[../../spec.md](../../spec.md): amend when a decision holds and its reasoning
needs extending; supersede when its Context or Options no longer describe
reality.

The published package was never a plugin. It was a shipping container for a
React application: the DevTools source is ~28,800 lines across five packages,
and the plugin inlined ~9 MB of built UI into its own `dist`.

## Options

| Option | Rejected because |
| --- | --- |
| **Keep the artifact handoff, improve certification** | Preserves a two-repo handoff, pin automation, a manifest-update PR flow, a release-time liveness gate and a trust boundary — all of which exist *only* because the source is elsewhere. It optimises the cost rather than removing it |
| **Move only the plugin, keep the UI upstream** | The plugin's build compiles the UI from source; splitting them leaves the same cross-repo build dependency with none of the simplification |
| **Move the source into contrib and build it normally (chosen)** | — |

## Decision

The DevTools source moves into `livestorejs/livestore-contrib` as ordinary
workspace packages on the standard build, test and release machinery. The
artifact producer is retired and the handoff repository is archived.

Scope of this record is the **boundary**, not the licence and not the versioning
policy:

- **Licence** is decided in livestorejs/livestore#1511 and consumed here.
- **Versioning** is unchanged and already covered by
  [0001-two-repo-composition](0001-two-repo-composition.md) §"Exact Lockstep
  Versions At Publish". This record adds no versioning decision — see
  *Evidence* for why that section already governs the incoming packages.

Two invariants survive the boundary's removal and must hold by other means:

1. **A published DevTools package must actually boot.** Previously proven by a
   release-time liveness gate against the artifact. Now owed by an exact-install
   boot gate: pack through the release pipeline, install into a clean tree, boot,
   assert real app data renders.
2. **Compatibility for out-of-band surfaces** — anything installed and updated
   independently of the app, today the Chrome extension — is negotiated on the
   wire, not inferred from a version.

## Evidence and Argument

**The boundary was the cost, measured in-tree.** `devenv.nix` carries 289
directly removable lines across ranges `75-310` and `465-517`, including a
196-line certify-liveness block and **seven** `release:devtools-artifact:*`
tasks. The workflow pair is 844 lines; the command and its test are 1,006.
`release/devtools-artifact.json` is referenced by eight other files. (Counts
verified against `main` on 2026-07-29; this issue's earlier estimates of "~285 of
662 lines", "four tasks" and "six other places" were each wrong.)

**Building from source found defects the artifact boundary had hidden.** All
four surfaced only by executing the pipeline, not by reading it:

- `release/simulate-publish.mjs` could not write generated manifests — they are
  mode `0444` and it wrote directly, raising `EACCES`. Dated from `git log`:
  snapshot manifest rewriting landed `2026-06-15`, Genie began emitting `0444` on
  `2026-07-01`, and `release:surface:check` **only plans — it never enters the
  pack branch**. Contrib's real pack path had therefore been broken for roughly a
  month with nothing detecting it.
- `devtools-react`'s release build invoked a `tailwindcss` binary that does not
  exist: Tailwind v4 moved it to `@tailwindcss/cli`.
- `devtools-vite`'s ported `build.ts` used Effect 3's `Cli.Options` against a
  pinned Effect 4 exposing `Cli.Flag`.
- Nine example manifests still resolved the npm artifact, so a smoke test served
  the *old* embedded bundle while every static check passed.

**The extraction boundary was not clean, contrary to this issue's earlier
claim.** A fresh import scan found the packages also referenced `@overeng/meters`,
`@overeng/bonsai-design`, `@overtone/utils-frontend` and `@overtone/utils/node`.
`@overtone/utils/node` was resolved by **replacement** — `pack-release` now
derives its package directory from `node:url` `fileURLToPath(import.meta.url)`
with `CurrentWorkingDirectory.fromPath` — so no private code entered the public
repository. The remaining copied code is relicensed as first-party with
provenance recorded, per the rights-holder's decision of 2026-07-29.

**Publication safety was gated, not assumed.** An independent scan of the
publication diff returned `DO NOT PUSH` on the first attempt, finding a captured
real-session fixture (internal product identifiers, private sync-engine labels,
personal-domain OAuth endpoints), two opaque personal share URLs, a
Chromium-derived stylesheet whose header pointed recipients at the wrong licence,
a licence whose own Notices clause required a copyright notice absent from the
file, and internal agent/session trailers in all six commit bodies. Each was
remediated and re-verified against committed bytes.

**Versioning needs no new decision here.** `0001` §"Exact Lockstep Versions At
Publish" already decides that contrib mirrors core's version stamp and rewrites
`workspace:*` to exact versions at publish, explicitly rejecting version ranges
because "published graphs become non-deterministic".
`release/simulate-publish.mjs` implements exactly that, returning a bare version
string with no caret in the rewrite path. Published contrib packages on npm show
`^0.4.0`, but those were cut **2026-06-02**, five days *before* that pipeline
landed on **2026-06-07** — they predate it rather than contradict it.
**Consequence to expect:** the first contrib publish through the current pipeline
changes the published dependency shape from `^0.4.0` to exact for existing
consumers.

## Consequences

- Core's release no longer depends on a contrib publish, and the pin, repack and
  certify machinery is deleted (tracked in livestorejs/livestore#1497 M5).
- **A DevTools-only fix now costs a full release-group publish**, and a core
  patch republishes DevTools with an unchanged build under a new number. This is
  the capability `0002` was protecting and it is deliberately traded away.
- `devtools-chrome` cannot be lockstepped at all — it never reaches npm. Its
  binding to a release is the wire protocol.
- Deleting `scripts/src/commands/devtools-artifact.ts` would also delete core's
  **only** GitHub Release publisher and its **only** git-tag creator. Verified
  independently: executable `gh release view|edit|create|upload` exists nowhere
  else, and no other `git tag` writer exists in core's release machinery. The
  relocation is therefore a prerequisite, landed separately in
  livestorejs/livestore#1521.
