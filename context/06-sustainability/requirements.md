# Sustainability — Requirements

Role: owns how the project stays maintained without a company — license
policy, funding model, and the boundaries of commercial surfaces.

## Context

Builds on the root [requirements.md](../requirements.md). Grounded in
`LICENSE`, `.github/FUNDING.yml`, and
`docs/src/content/docs/sustainable-open-source/sponsoring.mdx` (derived
surface per LS-R15).

## Acceptable Tradeoffs

- **LS.SUST-T01 Sponsorware devtools:** Distributing devtools under a
  sponsor license (rather than fully open) is accepted as a funding
  mechanism. Opening much of the devtools UI as a component kit is roadmap
  (root [roadmap.md](../roadmap.md)).

## Requirements

- **LS.SUST-R01 Open-source core:** The core repository (engine, primary
  adapters, sync provider, docs, examples) is licensed Apache-2.0.
- **LS.SUST-R02 Sponsor funding:** The project is funded through
  sponsorship (GitHub Sponsors, partner sponsors) — not venture capital and
  not a first-party hosting service. `refines: LS-A05`
- **LS.SUST-R03 Devtools as sponsor benefit:** Devtools licenses are granted
  through sponsorship; free licenses are available to students on request.
- **LS.SUST-R04 No hosting lock-in:** Sync is served via partner services
  and self-hosting; the project does not operate a first-party hosted sync
  service. `refines: LS-R08`
- **LS.SUST-R05 Published benefits:** Sponsor benefits are published and
  honored via the sponsor dashboard (devtools license, sponsor-only Discord,
  office hours, prioritized fixes/requests).
