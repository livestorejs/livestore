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

Licensing is per package, not per repository: `livestorejs/livestore` and
`livestorejs/livestore-contrib` both carry per-package `LICENSE` files, and each
repository root states which subtrees it does not cover.

## Funding Channels (LS.SUST-R02)

Sponsorship-first (decided 2026-07-16, interview):

- GitHub Sponsors (`.github/FUNDING.yml` → `schickling`).
- Partner sponsors (currently ElectricSQL, Netlify, Expo, Axial).
- Explicitly rejected paths: VC funding (no VC-scale business intended) and
  a first-party hosting service (partnerships with sync services are
  preferred; avoids vendor lock-in) — see the sponsoring page FAQ.
- Possible future channels (non-normative; consistent with the docs FAQ):
  commercial licenses, paid consulting, premium devtools. None is active
  today beyond the sponsor-licensed devtools.

## Brand (LS.SUST-R06)

The LiveStore name and logo are held by the project creator (BDFL); there is
no formal trademark policy. Forks and contrib packages use the name in
good faith (e.g. `@livestore/*` scope membership is granted by the project).
Captured as current state 2026-07-16 (interview).

## Benefit Mechanics (LS.SUST-R05)

Sponsor dashboard at `livestore.dev/sponsor` grants: devtools license,
sponsor-only Discord channels, office hours, prioritized bug fixes and
feature requests. Student devtools licenses via Discord request.

## Open Design Questions

- **LS.SUST-DQ1 Licensing model.** **Resolved 2026-07-27** —
  [decision 0001](./.decisions/0001-community-license.md) adopts a size-gated
  source-available license across all packages with a two-year per-version
  conversion to Apache-2.0. What remains open is not the model but its
  execution: the licence text is drafted and pending review by counsel; the
  commercial licence (price, term, seat-vs-org basis, purchase path) does not
  yet exist and must before the change ships; and `vision.md` still describes
  the project as community-owned open source sustained through sponsorship
  alone, which this decision makes inaccurate. `LS-A05 "No company"` is also in
  tension with the intent to assign the licensor role to an entity.


- **LS.SUST-DQ2 Scaling maintainership.** The stated goal of funding
  additional maintainers has no defined thresholds or mechanics.
