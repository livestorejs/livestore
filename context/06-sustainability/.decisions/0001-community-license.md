# 0001 — Adopt a size-gated source-available licence across all packages

Status: accepted (2026-07-27; decided by the project creator after a design
interview and comparative research across FSL, FCL, ELv2, BUSL and the PolyForm
family — see Evidence). Licence text is drafted and pending review by counsel;
that review does not reopen the decision below.

## Context

Every published `@livestore/*` package is Apache-2.0. DevTools is distributed
under a sponsor licence (LS.SUST-R03, LS.SUST-T01) and gated at runtime by a
third-party licensing SDK. LS.SUST-DQ1 recorded the licensing model as open and
blocked on a strategic decision by the project creator.

Two facts settled during investigation:

- **Consent is not a constraint.** A CLA is in place and contributors have
  agreed, so relicensing existing code is available — not merely the
  Apache-2.0 §4 "future versions only" path. The CLA is currently not
  discoverable from the repository, which is itself worth fixing.
- **Sponsorship alone has not funded the project as stated.** DevTools
  licensing already operates as a second channel, which LS.SUST-R02 does not
  describe.

## Options

1. **Stay Apache-2.0 everywhere.** No relicensing event, no fork trigger, no
   positioning cost. Leaves the engine generating no revenue and sponsorship
   as the only channel.
2. **Non-compete family** (FSL, BUSL, PolyForm Perimeter). Defends against a
   competitor reselling the software as a managed service.
3. **Size gate across all packages (chosen).** Organisations above a size
   threshold require a commercial licence; everyone else uses it free.

## Decision

Option 3, with these parameters:

- Free use requires **all three**: fewer than 10 total individuals, under
  USD 1,000,000 total revenue in the prior tax year, and under USD 1,000,000
  in aggregate external investment. Figures are fixed, not inflation-indexed.
  Affiliates under common control aggregate across all three.
- **Unconditional grants** regardless of the gate: individuals; nonprofit,
  educational, government and public research organisations; and a 30-day
  evaluation period.
- **Each version converts to Apache-2.0** on the second anniversary of its own
  publication, as a present and irrevocable grant.
- **No technical enforcement.** Enforcement is contractual.
- Name: LiveStore Community License 1.0, declared as
  `LicenseRef-LiveStore-Community-1.0`. Licensor is the project creator
  personally, with intent to assign to an entity later. The public licence is
  silent on governing law; the commercial licence is not.
- `@livestore/wa-sqlite` remains MIT — it is a fork of
  [`rhashimoto/wa-sqlite`](https://github.com/rhashimoto/wa-sqlite) and its
  value is upstream's.
- Prior Apache-2.0 releases are unaffected and remain forkable.

## Rationale

**Why not option 2.** Every restrictive licence in the canon defends one threat
model: a cloud provider reselling the software as a managed service. LiveStore
is a client-side library — nobody can host it — and LS.SUST-R04 already commits
the project to not operating a sync service. FSL's Permitted Purpose explicitly
enumerates "for your internal use and access", so an enterprise using LiveStore
internally would be permitted freely and permanently. A non-compete would gate
nobody the project wants to convert.

**Why no technical enforcement.** Every working licence mechanism in this
ecosystem is anchored to a rendering surface — a watermark or banner visible in
the licensee's shipped product. LiveStore renders nothing, so there is nothing
for a mechanism to attach to. Mapbox GL JS v2 added runtime validation to a
library and was forked into MapLibre within weeks; RxDB, the closest structural
analogue, gates at install and advertises that it ships no validation into user
bundles.

**Why the 2-year conversion.** It answers "what happens if the maintainer
stops", which a solo project is asked harder than a company. A two-year-old
build of a fast-moving library has little commercial value, so the concession
costs little and is the reason this remains eventually-open-source.

## Consequences

- LiveStore becomes commercial software with a free tier rather than open
  source with a paid tool. `vision.md` requires a pass; that file is
  human-owned.
- Revises LS.SUST-R01, LS.SUST-R02, LS.SUST-R03 and LS.SUST-R05; retires
  LS.SUST-T01. Re-scopes LS.SUST-DQ1.
- LS-A05 ("no company") is in tension with the intent to assign to an entity.
- The existing runtime licensing SDK and its `ENFORCE_LICENSE` flag are
  retired after a grace period covering current activations.
- **Accepted risk:** competitors are permissively licensed (Zero is
  Apache-2.0; Yjs and TinyBase are MIT). A non-OSI identifier fails enterprise
  allowlist checks silently, and lost evaluations are not observable. Two of
  five canonical relicensings were later reversed (Elastic 2024, Redis 2025),
  both after ecosystem loss.

## Evidence

Comparative research across FSL-1.1, FCL-1.0, Elastic License 2.0, BUSL-1.1 and
the PolyForm family, with adoption and outcome data; SPDX list `e4c1f27`
(`PolyForm-Small-Business-1.0.0` and `FSL-1.1-ALv2` listed, `FCL-1.0-ALv2`
absent); a codebase authorship census over all 335 non-test source files; and a
survey of licence-enforcement mechanisms in JavaScript libraries (AG Grid,
Highcharts, Kendo, FusionCharts, RxDB, Mapbox GL). Tracked in
[livestorejs/livestore#1511](https://github.com/livestorejs/livestore/issues/1511).
