# Sustainability — Spec

This document specifies the sustainability model. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## License Inventory (LS.SUST-R01, R03)

| Surface                             | License                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `livestorejs/livestore` (this repo) | Apache-2.0                                                       |
| `livestorejs/livestore-contrib`     | Apache-2.0 (same product identity)                               |
| Devtools                            | Free to use; no license, trial, sponsorship, or sign-in required |

## Funding Channels (LS.SUST-R02)

Sponsorship-first (decided 2026-07-16, interview):

- GitHub Sponsors (`.github/FUNDING.yml` → `schickling`).
- Partner sponsors (currently ElectricSQL, Netlify, Expo, Axial).
- Explicitly rejected paths: VC funding (no VC-scale business intended) and
  a first-party hosting service (partnerships with sync services are
  preferred; avoids vendor lock-in) — see the sponsoring page FAQ.
- Possible future channels (non-normative; consistent with the docs FAQ):
  commercial licenses and paid consulting. Neither is active today.

## Brand (LS.SUST-R06)

The LiveStore name and logo are held by the project creator (BDFL); there is
no formal trademark policy. Forks and contrib packages use the name in
good faith (e.g. `@livestore/*` scope membership is granted by the project).
Captured as current state 2026-07-16 (interview).

## Benefit Mechanics (LS.SUST-R05)

Sponsor dashboard at `livestore.dev/sponsor` grants: sponsor-only Discord
channels, office hours, prioritized bug fixes and feature requests.
Devtools are free for everyone, independently of sponsorship.

## Open Design Questions

- **LS.SUST-DQ1 Licensing model.** Whether LiveStore keeps its current model
  (permissive open-source core, Apache-2.0, plus free devtools with separate
  source availability — LS.SUST-R01/R03, LS.SUST-T01) or moves to a source-available model
  that better funds maintenance. **Leading direction (2026-07-17, interview —
  not yet decided):** a single time-delayed license over the _whole_ system
  (FSL or similar — source-available now, converting to a permissive license
  after a rolling window), which would also open the devtools source. Candidate
  families in
  [.reference/license-model-options.md](./.reference/license-model-options.md).
  Implications, none settled until the decision is made:
  - **Identity / vision.** A whole-product time-delayed license means the core
    is not OSI "open source" _now_ (it becomes "eventually open source" / fair
    source). This changes what LiveStore _is_, needs a `vision.md` pass
    (human-only), and would revise LS.SUST-R01 (core Apache-2.0) plus
    LS.SUST-R03/T01 (devtools source availability, independently of free access).
  - **Positioning wording.** The sponsoring page's "fully open source" line is
    rewritten to match the chosen model.
  - **Mechanics** (tiers, per-seat vs per-org, lapse, enforcement) and the
    **UI-component-kit** boundary are subsumed / moot until the model is chosen.
    Blocked on: a strategic decision by the project creator (+ legal review).
    Reframed 2026-07-17 (interview) from a narrower "wording + mechanics"
    question.
- **LS.SUST-DQ2 Scaling maintainership.** The stated goal of funding
  additional maintainers has no defined thresholds or mechanics.
