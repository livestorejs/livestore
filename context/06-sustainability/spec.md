# Sustainability — Spec

This document specifies the sustainability model. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## License Inventory (LS.SUST-R01, R03)

| Surface | License |
| --- | --- |
| All published `@livestore/*` packages | LiveStore Community License 1.0 (`LicenseRef-LiveStore-Community-1.0`) |
| `@livestore/wa-sqlite` | MIT (fork of `rhashimoto/wa-sqlite`, © Roy T. Hashimoto) |
| Releases published before 2026-07-27 | Apache-2.0, irrevocably |
| Every version, from its second anniversary | Apache-2.0, by present grant |

Licensing is per package, not per repository. Package-level licence files
define the applicable terms; repository roots state which subtrees they do not
cover.

## Funding Channels (LS.SUST-R02)

Sponsorship-first (decided 2026-07-16, interview):

- GitHub Sponsors (`.github/FUNDING.yml` → `schickling`).
- Partner sponsors (currently ElectricSQL, Netlify, Expo, Axial).
- Explicitly rejected paths: VC funding (no VC-scale business intended) and
  a first-party hosting service (partnerships with sync services are
  preferred; avoids vendor lock-in) — see the sponsoring page FAQ.
- Commercial licensing is adopted but does not become active until the
  licence text, commercial terms, and purchase path are ready.
- Paid consulting remains a possible future channel (non-normative).

## Brand (LS.SUST-R06)

The LiveStore name and logo are held by the project creator (BDFL); there is
no formal trademark policy. Forks and contrib packages use the name in
good faith (e.g. `@livestore/*` scope membership is granted by the project).
Captured as current state 2026-07-16 (interview).

## Benefit Mechanics (LS.SUST-R05)

Sponsor dashboard at `livestore.dev/sponsor` grants: sponsor-only Discord
channels, office hours, prioritized bug fixes and feature requests.

## Open Design Questions

- **LS.SUST-DQ1 Licensing model.** **Resolved 2026-07-27** — the accepted
  [licensing decision](https://github.com/livestorejs/livestore/issues/1511)
  adopts a size-gated source-available license across all packages with a
  two-year per-version conversion to Apache-2.0. What remains open is execution:
  the licence text awaits counsel review; the commercial licence and purchase
  path must exist before the change ships; and the protected project vision
  still needs a maintainer-owned consistency pass.
- **LS.SUST-DQ2 Scaling maintainership.** The stated goal of funding
  additional maintainers has no defined thresholds or mechanics.
