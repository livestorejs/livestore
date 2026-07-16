# Sustainability — Spec

This document specifies the sustainability model. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## License Inventory (LS.SUST-R01, R03)

| Surface | License |
| --- | --- |
| `livestorejs/livestore` (this repo) | Apache-2.0 |
| `livestorejs/livestore-contrib` | Apache-2.0 (same product identity) |
| Devtools | Sponsor license, delivered via the sponsor dashboard |

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

- **LS.SUST-DQ1 "Fully open source" wording + devtools license mechanics.**
  The sponsoring page calls the project "fully open source" while devtools
  ship under a sponsor license; the positioning wording and the policy need
  reconciliation. The same session also owns the undefined devtools license
  mechanics: tiers, per-seat vs per-org, lapse behavior on ended
  sponsorship, and enforcement (decided 2026-07-16 to defer wholesale).
  Blocked on: a dedicated sustainability/licensing session (intersects the
  roadmap plan to open-source the devtools UI as a component kit).
- **LS.SUST-DQ2 Scaling maintainership.** The stated goal of funding
  additional maintainers has no defined thresholds or mechanics.
