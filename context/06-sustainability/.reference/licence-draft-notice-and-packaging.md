# Notice and packaging

**Draft prepared for legal review. This is not legal advice.** This document is the
mechanical companion to `LICENSE.md`: what each `package.json` declares, which `LICENSE`
file goes where, and how the Apache-2.0 boundary is stated.

The licence is the **LiveStore Community License 1.0**, declared in SPDX as
`LicenseRef-LiveStore-Community-1.0`. The licensor is **Johannes Schickling**.
`{{LICENCE_URL}}` is the project-hosted canonical URL and is the only unresolved
placeholder, apart from `{{FIRST_COVERED_VERSION}}` which the project must choose.

---

## 1. Current published state — verified

Queried 2026-07-27 against the npm registry's org endpoint
(`https://registry.npmjs.org/-/org/livestore/package`), which is authoritative for scope
membership, then per-package for the `latest` dist-tag. **The org publishes 39 packages
under `@livestore/*`** — considerably more than the requirements document implies.

Do not build the relicensing checklist from `npm search`: it returns 38 and silently
omits at least `@livestore/devtools-react`. Use the org endpoint.

### Current generation — 25 packages, all at 0.4.0, published 2026-06-02

| Package | `license` field |
| --- | --- |
| `@livestore/livestore` | `Apache-2.0` |
| `@livestore/common` | `Apache-2.0` |
| `@livestore/common-cf` | `Apache-2.0` |
| `@livestore/utils` | `Apache-2.0` |
| `@livestore/utils-dev` | `Apache-2.0` |
| `@livestore/peer-deps` | `Apache-2.0` |
| `@livestore/webmesh` | `Apache-2.0` |
| `@livestore/sqlite-wasm` | `Apache-2.0` |
| `@livestore/framework-toolkit` | `Apache-2.0` |
| `@livestore/adapter-web` | `Apache-2.0` |
| `@livestore/adapter-node` | `Apache-2.0` |
| `@livestore/adapter-expo` | `Apache-2.0` |
| `@livestore/adapter-cloudflare` | `Apache-2.0` |
| `@livestore/react` | `Apache-2.0` |
| `@livestore/solid` | `Apache-2.0` |
| `@livestore/svelte` | `Apache-2.0` |
| `@livestore/graphql` | `Apache-2.0` |
| `@livestore/cli` | `Apache-2.0` |
| `@livestore/sync-cf` | `Apache-2.0` |
| `@livestore/sync-electric` | `Apache-2.0` |
| `@livestore/sync-s2` | `Apache-2.0` |
| `@livestore/devtools-expo` | `Apache-2.0` |
| `@livestore/devtools-web-common` | `Apache-2.0` |
| **`@livestore/devtools-vite`** | **absent** |
| **`@livestore/wa-sqlite`** | **absent** |

### Legacy and dormant — 14 packages, last published 2024-02 to 2025-12

| Package | Latest | Last published | `license` field |
| --- | --- | --- | --- |
| `@livestore/web` | 0.2.0 | 2024-11-22 | absent |
| `@livestore/node` | 0.3.0-dev.4 | 2025-01-27 | absent |
| `@livestore/expo` | 0.2.0 | 2024-11-22 | absent |
| `@livestore/tauri` | 0.0.57 | 2024-09-06 | absent |
| `@livestore/cf-sync` | 0.0.57 | 2024-09-06 | absent |
| `@livestore/db-schema` | 0.2.0 | 2024-11-22 | absent |
| `@livestore/sql-queries` | 0.0.41 | 2024-02-18 | absent |
| `@livestore/fractional-index` | 0.0.46-dev.4 | 2024-03-17 | absent |
| `@livestore/effect-playwright` | `0.0.0-snapshot-…` | 2024-11-04 | absent |
| `@livestore/devtools-react` | 0.2.0 | 2024-11-22 | absent, **deprecated** |
| `@livestore/devtools-expo-bridge` | 0.0.56 | 2024-08-19 | absent |
| `@livestore/devtools-expo-common` | 0.2.0 | 2024-11-22 | absent |
| `@livestore/devtools-node-common` | 0.3.0-dev.4 | 2025-01-27 | absent |
| `@livestore/sync-http` | `0.0.0-snapshot-…` | 2025-12-14 | `Apache-2.0` |

Not published to npm at all: **`@livestore/devtools-chrome`**. See §6.

### Three corrections to the requirements document

1. It calls the engine package `livestore`. **No package of that bare name exists on
   npm** (404). It is `@livestore/livestore`. A checklist keyed to the bare name misses
   the single most important package.
2. It lists `devtools-chrome` among packages to relicense. It is **not on npm**, so it
   has no `package.json` `license` field to change. Different mechanism — §6.
3. It treats `devtools-react` as a current DevTools package. It was **last published
   2024-11-22 at 0.2.0 and is deprecated on the registry**. It is not part of the 0.4.0
   generation. The current DevTools surface on npm is `devtools-vite`, `devtools-expo`
   and `devtools-web-common`. Relicensing `devtools-react` would be relicensing a
   dead package; fixing its absent `license` field is still worthwhile (§3, Group D).

### The absent `license` fields

**15 of 39 packages publish with no `license` field** — 2 in the current generation
(`devtools-vite`, `wa-sqlite`) and 13 legacy. This is the material defect and it is
five times larger than the requirements document records.

A reader of `@livestore/devtools-vite@0.4.0` finds no package-level licence, follows the
repository link, finds an Apache-2.0 root `LICENSE`, and reasonably concludes Apache-2.0
applies. That inference actively undercuts the commercial position. **Fix all 15
regardless of whether the licence change proceeds** — this is hygiene, not strategy, and
it is independently worth doing.

---

## 2. The `package.json` `license` field

A bespoke licence has no SPDX-listed identifier. SPDX's own mechanism for this is the
`LicenseRef-` form, which is valid SPDX expression syntax and is what npm's own
documentation points to for non-standard licences.

**Every package moving to the new licence declares:**

```json
"license": "LicenseRef-LiveStore-Community-1.0"
```

This is the settled identifier. Counsel should confirm it is one the project is content
to have appear in every downstream SBOM and licence report, since it is effectively
permanent once published.

Rules:

- **Do not** use a bare string such as `"LiveStore-Community-1.0"`. It is not valid
  SPDX and tooling will classify it as unknown or, worse, silently ignore it.
- **Do not** use `"SEE LICENSE IN LICENSE.md"`. It is accepted by npm but conveys
  nothing to an SBOM scanner and will be reported as an unidentified licence.
- **Do not** leave the field absent. That is the current defect.
- Add `"files"` coverage so the `LICENSE.md` is actually included in the published
  tarball. npm includes a file named `LICENSE` or `LICENSE.md` at the package root
  automatically, but confirm this per package rather than assuming it.

Expected downstream behaviour, which should be communicated in the announcement: SBOM
and licence-scanning tools will report `LicenseRef-LiveStore-Community-1.0` as a
non-OSI-approved, unrecognised licence requiring manual review. This is correct and
unavoidable for any bespoke licence. It is a friction point for enterprise adopters and
should be anticipated, not discovered.

---

## 3. Which package gets which licence

### Group A — new licence, `LicenseRef-LiveStore-Community-1.0`

The **24 current-generation packages** from §1, excluding `wa-sqlite` (Group B):

`@livestore/livestore`, `common`, `common-cf`, `utils`, `utils-dev`, `peer-deps`,
`webmesh`, `sqlite-wasm`, `framework-toolkit`, `adapter-web`, `adapter-node`,
`adapter-expo`, `adapter-cloudflare`, `react`, `solid`, `svelte`, `graphql`, `cli`,
`sync-cf`, `sync-electric`, `sync-s2`, `devtools-expo`, `devtools-web-common`,
`devtools-vite`.

Each gets:
- `"license": "LicenseRef-LiveStore-Community-1.0"` in `package.json`
- a `LICENSE.md` at the package root containing the full new licence text, with all
  placeholders resolved

**Question for counsel (Q-P1):** `utils`, `utils-dev`, `peer-deps` and
`framework-toolkit` are internal or build-time packages rather than parts of the
shipped library surface. Relicensing them is the conservative default and is what
"all published `@livestore/*` packages" in the requirements says. But `utils-dev` in
particular is plausibly a build dependency of *contributors*, not of licensees, and
gating it may create friction with no commercial upside. Worth a deliberate decision
rather than inheriting one from a wildcard.

### Group B — stays MIT

**`@livestore/wa-sqlite`.** A fork of [`rhashimoto/wa-sqlite`], MIT © 2023 Roy T.
Hashimoto. MIT permits sublicensing under different terms provided the notice is
preserved, but the value in that package is upstream's, and anyone gated by the new
licence could simply use upstream directly. Relicensing it buys nothing and costs
goodwill.

- `"license": "MIT"` — this is a **fix to a current defect**, not a change; the package
  publishes with no `license` field today and must declare MIT regardless of whether the
  wider licence change proceeds.
- `LICENSE` at package root: the upstream MIT text with Roy T. Hashimoto's copyright
  notice intact, plus a second copyright line for the fork's own changes if the project
  asserts one.

**Question for counsel (Q-P2):** does the fork contain enough original authorship to
warrant a second copyright line, and if so in whose name?

### Group C — not published to npm

**`@livestore/devtools-chrome`.** See §6.

### Group D — legacy and dormant, 14 packages

The packages in §1's second table. None has been published since 2025-12 and most since
2024. **Recommendation: do not relicense them.** Reasons:

- A new release of a dead package purely to change its licence signals nothing useful and
  invites the reading that the project is retroactively narrowing rights, which is
  exactly the impression to avoid.
- Their existing published versions stay under whatever terms they carried, which nothing
  can change (see §5).
- Several are superseded by current-generation equivalents (`web` → `adapter-web`, `node`
  → `adapter-node`, `expo` → `adapter-expo`, `cf-sync` → `sync-cf`).

**But do two things:**

1. **Deprecate them on the registry** with a message pointing at the successor package,
   as has already been done for `devtools-react`. This is the honest signal, it costs
   nothing, and it stops new adopters landing on an unlicensed package.
2. **If any is republished for any reason**, it must carry a `license` field at that
   point — either `Apache-2.0` if it stays legacy, or `LicenseRef-LiveStore-Community-1.0` if it
   is revived into the current generation.

**Question for counsel (Q-P3):** 13 of these 14 packages have published for years with
**no `license` field at all**. What terms, if any, govern a user who installed one of
them? The absence of a licence grant is ordinarily "all rights reserved", which is a
worse position for those users than Apache-2.0, and is unlikely to be what was intended
given the repository root was Apache-2.0 throughout. Is a clarifying public statement
that those versions were and remain available under Apache-2.0 advisable, and does
making it carry any risk?

---

## 4. Repository root `LICENSE` files

There are **two** repositories, and both roots are currently Apache-2.0. Both must be
updated; changing only one leaves a contradictory record.

- `livestorejs/livestore` — root `LICENSE` is Apache-2.0
- `livestorejs/livestore-contrib` — root `LICENSE` is Apache-2.0, and its nine
  `packages/@livestore/*` packages all declare `Apache-2.0`

Each root `LICENSE` must state three things: what it covers, what it does not, and the
version boundary. Suggested wording for both roots, adjusted per repo:

```
# Licensing

Except as stated below, the contents of this repository are licensed under the
LiveStore Community License 1.0. The full text is in LICENSE.md in this directory
and at {{LICENCE_URL}}. Copyright Johannes Schickling.

## Subtrees under different terms

- packages/@livestore/wa-sqlite is licensed under the MIT License. It is a fork of
  https://github.com/rhashimoto/wa-sqlite, Copyright (c) 2023 Roy T. Hashimoto. See
  the LICENSE file in that directory.

## Earlier releases

Versions of the LiveStore packages published before {{FIRST_COVERED_VERSION}} were
released under the Apache License, Version 2.0. That licence is perpetual and
irrevocable for those versions. It is unaffected by this change, and those versions
remain available under it.

## Every release becomes Apache-2.0 after two years

Each version released under the LiveStore Community License 1.0 also becomes
available under the Apache License, Version 2.0 on the second anniversary of the
date it was first made available. Each version has its own date. See the "Later
Apache License" section of LICENSE.md.

A copy of the Apache License, Version 2.0 is kept in LICENSE-APACHE-2.0 in this
directory, for both of the purposes above.

This licensing information is provided for convenience. The operative terms are those
in the licence texts themselves.
```

Notes on that wording:

- The existing Apache-2.0 text is **kept in the repository**, renamed to
  `LICENSE-APACHE-2.0`, rather than deleted. Deleting it makes it harder for a user of a
  prior version to find the terms that still govern them, and reads as an attempt to
  obscure the earlier grant.
- `{{FIRST_COVERED_VERSION}}` should be a concrete version number decided before
  launch — for example `0.5.0`. State the number, not a date. Users reason about
  versions; git history and release dates are ambiguous.
- The root `LICENSE` should be renamed to `LICENSE.md` if it now contains Markdown, or
  the block above should be plain text. Do not leave a Markdown document in a file named
  `LICENSE` that tooling will try to match against known licence texts.

---

## 5. The two Apache-2.0 boundaries — how they are stated, and where

There are now **two** distinct relationships to Apache-2.0, and conflating them in
communications will confuse everyone:

- **Backward:** releases before `{{FIRST_COVERED_VERSION}}` were published under
  Apache-2.0 and stay there permanently. A fixed, closed set.
- **Forward:** every release from `{{FIRST_COVERED_VERSION}}` onward *becomes*
  Apache-2.0 two years after its own publication. A rolling, open set that grows
  continuously.

The practical upshot for a reader is simple and should be stated that way: **every
version of LiveStore is Apache-2.0, either already or within two years.** The community
licence governs a two-year window on each release, and nothing more.

### The per-version conversion date must be recorded

The licence lets the licensor ship an `Apache Date:` plain-text line stating a version's
exact conversion date. **Use it.** Without it, a licensee has to establish "the date the
licensor first made that version available" from the registry, and while npm's `time`
field is authoritative and public, relying on a third party's metadata to fix a licence
date is avoidable fragility. Concretely:

- Add a line to each package's shipped notices at release time:
  `Apache Date: YYYY-MM-DD` — the publication date plus two years.
- Generate it from the release pipeline, not by hand. A wrong date is a wrong licence.
- **Publish a conversion table** on the docs site: version, publication date, Apache-2.0
  date. This is the single most useful artefact for an enterprise adopter evaluating the
  licence, and it costs nothing to maintain from release metadata.
- Keep `LICENSE-APACHE-2.0` in both repository roots permanently. It is now referenced by
  a live, ongoing mechanism, not just by history.

**Question for counsel (Q-P6):** the conversion runs from "the date the licensor first
made that version available". For an npm package this is unambiguous — the registry
records it. But a version reachable from a git tag, a GitHub release, or a prerelease
dist-tag before the npm publish could arguably start the clock earlier. Should the
licence define availability by reference to the npm publication specifically, or is the
`Apache Date:` line sufficient to remove the ambiguity in practice?

### Where each boundary is stated

The backward boundary is stated in **four** places, deliberately redundantly, because
each audience reaches for a different one:

1. **Repository root `LICENSE`** — the "Earlier releases" paragraph in §4. For someone
   browsing the repo.
2. **`package.json` of each new release** — the `license` field changes to
   `LicenseRef-LiveStore-Community-1.0` at `{{FIRST_COVERED_VERSION}}` and stays `Apache-2.0` in
   every already-published version. Already-published `package.json` files are immutable
   on npm; **do not** attempt to amend them, and do not unpublish. The registry record is
   the strongest evidence of what was granted, and it is correct as it stands.
3. **Release notes for `{{FIRST_COVERED_VERSION}}`** — a plain statement that this
   release and later ones are under the new licence, that earlier releases remain under
   Apache-2.0, and that the Apache-2.0 grant on those is irrevocable.
4. **A `Required Notice:` line shipped with the software**, if the project uses that
   mechanism from `LICENSE.md`:

   ```
   Required Notice: Copyright Johannes Schickling
   ```

The operative fact that must not be muddied anywhere: **Apache-2.0 §2 grants are
perpetual and irrevocable.** Versions already published cannot be withdrawn and remain
forkable. Any communication implying otherwise is both wrong and damaging. Nothing in
the new licence purports to affect them; the backward boundary is drawn by *which text
ships with which version*, not by a clause describing its own scope.

Note that `LICENSE.md` does now name Apache-2.0, in `Later Apache License`. That is the
forward boundary and it belongs in the operative text, because it is a grant the licence
itself makes. The backward boundary still does not, and should not, appear there.

**Question for counsel (Q-P4):** should the root `LICENSE` say anything more than the
paragraph above about the surviving Apache-2.0 grant on pre-`{{FIRST_COVERED_VERSION}}`
releases? The requirements list this as an open item. The drafting position taken here
is: state it plainly once, in the repo root and the release notes, and keep it out of
the operative licence text.

---

## 6. `@livestore/devtools-chrome`

Not published to npm, so there is no `package.json` `license` field in a registry record
to fix. Assuming it ships as a Chrome Web Store extension:

- The extension's `manifest.json` has no licence field. Chrome Web Store listings carry a
  developer-supplied terms-of-use / privacy URL instead. Point it at `{{LICENCE_URL}}`.
- Ship `LICENSE.md` inside the extension package, at its root.
- If the extension source lives in a public repository, that repository's root `LICENSE`
  must carry the same statement as §4.
- The Chrome Web Store's own Developer Program Policies apply on top and are not
  displaced by this licence. Counsel may want to check there is no conflict.

**Question for counsel (Q-P5):** does distribution through a third-party store impose
any licence-presentation requirement that `LICENSE.md`'s [Notices] section does not
already satisfy?

---

## 7. Third-party notices produced by licensees

`LICENSE.md`'s [Notices] section lets a licensee who ships the software only as part of
a bundled application satisfy the notice obligation through a third-party-notices file
rather than by shipping the licence text as a separate file. This is deliberate — see
`REVIEW-NOTES.md` §4b — because the alternative reading puts every licensee shipping a
minified web bundle in technical breach.

To make that easy in practice, the project should publish a short, copy-pasteable
attribution block for licensees to include, for example:

```
This product includes LiveStore ({{LICENCE_URL}}).
Copyright Johannes Schickling. Licensed under the LiveStore Community License 1.0.
```

This is documentation, not licence text, and should live in the docs site rather than in
`LICENSE.md`.

---

## 8. Pre-launch checklist

1. Resolve `{{LICENCE_URL}}` in `LICENSE.md`; choose A or B in the one remaining Variant
   block (`No Liability`); delete all HTML comments.
2. Confirm `LICENSE.md` names neither licence family it was adapted from — see
   `REVIEW-NOTES.md` §2. Grep for both.
2a. Wire the `Apache Date:` line into the release pipeline and publish the conversion
   table (§5). This is a recurring release obligation, not a one-off launch task.
3. Fix the **two** absent `license` fields in the current generation (`devtools-vite`,
   `wa-sqlite`) — do this even if the licence change is deferred.
4. Decide what to do about the **13** absent `license` fields in the legacy packages
   (§3 Group D, Q-P3). Deprecating them on the registry is the recommended minimum.
5. Decide and record `{{FIRST_COVERED_VERSION}}`.
6. Re-run the org-endpoint listing immediately before launch and reconcile against
   Group A. The scope had grown by 18 packages beyond what the requirements document
   recorded; assume it has moved again.
7. Add `LICENSE.md` to every Group A package root; add MIT `LICENSE` to `wa-sqlite`.
8. Update both repository root `LICENSE` files; rename the existing Apache-2.0 text to
   `LICENSE-APACHE-2.0` in both.
9. Verify each published tarball actually contains its licence file
   (`npm pack --dry-run` per package).
10. Confirm the commercial licence is purchasable — see `COMMERCIAL-LICENSE-NOTES.md` §7.
11. Publish `{{LICENCE_URL}}` and confirm it resolves before the first covered release.
   Do not rely on any third party's domain for the canonical text; see `REVIEW-NOTES.md`
   §2.

[`rhashimoto/wa-sqlite`]: https://github.com/rhashimoto/wa-sqlite
[Notices]: ./LICENSE.md#notices
