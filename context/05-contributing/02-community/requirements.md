# Community — Requirements

Role: owns the public community surfaces and support expectations — the
non-sponsor side of the project's people model. Sponsor-only benefits live
in [../../06-sustainability/](../../06-sustainability/requirements.md);
repo collaboration mechanics in [../01-collaboration/](../01-collaboration/requirements.md).

## Context

Builds on the parent [requirements.md](../requirements.md). Grounded in
`docs/src/content/docs/misc/community.mdx` and the Discord server; those
docs pages are derived views of this node (LS-R15).

## Requirements

- **LS.CONTRIB.COMM-R01 Published community surfaces:** The public community
  surfaces — Discord (including `#contrib`), office hours, and contributor
  sync recordings — are published on the docs site with working join links.
  Adopted 2026-07-16 (interview).
- **LS.CONTRIB.COMM-R02 Best-effort support:** Support for non-sponsors is
  community-based and best-effort; no response-time commitment exists.
  Sponsor benefits (prioritized fixes, sponsor Discord) are the only
  elevated tier (`../../06-sustainability/` LS.SUST-R05). Adopted 2026-07-16
  (interview).
- **LS.CONTRIB.COMM-R03 Derived community pages:** The docs `misc/community`
  page and the community/support claims in the docs FAQ derive from this
  node and must not contradict it. `refines: LS-R15` Adopted 2026-07-16
  (interview).
- **LS.CONTRIB.COMM-R04 Contributor meeting schedule:** The contributor meeting
  has one versioned schedule in this repository. Its published dates use an
  explicit time zone and distinguish a regular cadence from moved or skipped
  occurrences. Public event listings and invitations must agree with the
  schedule. `refines: LS-R15`
- **LS.CONTRIB.COMM-R05 No paid publishing dependency:** Publishing the
  contributor meeting must work without an additional paid subscription.
  Required destinations must support automatic updates on the available free
  tier. A destination requiring manual duplication is excluded.
- **LS.CONTRIB.COMM-R06 Canonical meeting room:** Every published occurrence
  points participants to one documented video meeting room. The join URL and
  participant role are checked before announcement, and the room can be
  changed without editing every previously shared event link.
- **LS.CONTRIB.COMM-R07 Canonical public information:** A docs page presents
  the next two meetings from the repository schedule and is linked from each
  calendar event. Schedule changes reach that page within minutes without a
  full docs release. Failure to load the schedule is explicit.
- **LS.CONTRIB.COMM-R08 Explained schedule changes:** Rescheduling and
  cancellation require a short public reason. A rescheduled meeting retains
  its identity and resets the cadence for subsequent meetings. Cancellation
  requires the organizer to select the next two dates explicitly.
- **LS.CONTRIB.COMM-R09 Observable publication:** Publication is repeatable
  without duplicate events, reconciles two upcoming meetings, and reports
  destination failures. Existing invitations are retired only after their
  replacement is verified live.

## Open Design Questions

- **LS.CONTRIB.COMM-DQ1 Onboarding funnel.** There is no specced
  first-contribution path beyond the `help wanted` label and Discord
  `#contrib`; whether a deliberate first-issue funnel is wanted is
  undecided.
