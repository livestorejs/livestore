# Sustainability — Requirements

Role: owns how the project stays maintained without a company — license
policy, funding model, brand stewardship, and the boundaries of commercial
surfaces.

## Context

Builds on the root [requirements.md](../requirements.md). Grounded in the
repository `LICENSE` files (per-package since 2026-07-27; the root file states
which subtrees it does not cover), `.github/FUNDING.yml`, and
`docs/src/content/docs/sustainable-open-source/sponsoring.mdx` (derived
surface per LS-R15).

## Acceptable Tradeoffs

- **LS.SUST-T01 Source-available system:** Distributing the whole system
  under a size-gated source-available license (rather than an OSI-approved
  one) is accepted as a funding mechanism. Retires the earlier
  sponsorware-devtools tradeoff. The accepted cost is that competitors are
  permissively licensed and a non-OSI identifier can fail enterprise
  allowlist checks silently. Adopted 2026-07-27 —
  [decision 0001](./.decisions/0001-community-license.md).

## Requirements

- **LS.SUST-R01 Size-gated source-available:** All published packages are
  licensed under the LiveStore Community License: free for individuals,
  nonprofit/educational/government organizations, and organizations under all
  of 10 people, USD 1M revenue and USD 1M raised; a commercial license is
  required above that. Each version converts to Apache-2.0 on the second
  anniversary of its publication. `@livestore/wa-sqlite` remains MIT
  (upstream fork). Releases published before adoption remain Apache-2.0
  irrevocably. Revised 2026-07-27 —
  [decision 0001](./.decisions/0001-community-license.md).
- **LS.SUST-R02 Sponsorship and commercial licensing:** The project is
  funded through sponsorship (GitHub Sponsors, partner sponsors) **and**
  commercial licenses sold to organizations above the LS.SUST-R01 threshold —
  not venture capital and not a first-party hosting service. `refines: LS-A05`
- **LS.SUST-R03 Entitlement follows the license, not sponsorship:** Use is
  governed solely by LS.SUST-R01. Devtools are no longer a sponsor benefit and
  no runtime entitlement check is shipped; students and other individuals are
  covered by the license's unconditional individual grant rather than by
  request. Existing sponsor and student grants are honored through a stated
  migration window. Revised 2026-07-27 —
  [decision 0001](./.decisions/0001-community-license.md).
- **LS.SUST-R04 No hosting lock-in:** Sync is served via partner services
  and self-hosting; the project does not operate a first-party hosted sync
  service. `refines: LS-R08`
- **LS.SUST-R05 Published benefits:** Sponsor benefits are published and
  honored via the sponsor dashboard (sponsor-only Discord, office hours,
  prioritized fixes/requests). The devtools license left this list on
  2026-07-27; commercial licenses are sold separately from sponsorship.
- **LS.SUST-R06 Brand stewardship:** The LiveStore name and logo are
  stewarded by the project creator; use by forks and contrib packages is
  good-faith and informal (no formal trademark policy exists). Adopted
  2026-07-16 (interview).
