# Contributor Meetings — Requirements

Role: owns the contributor meeting schedule, public information, calendar
publication, and migration from independently managed invitations.

## Context

Builds on the community [requirements](../requirements.md). The docs page and
calendar events derive from this node and the versioned schedule.

## Requirements

- **LS.CONTRIB.COMM.MEET-R01 Versioned schedule:** One repository schedule
  defines meeting dates with an explicit time zone and moved or cancelled
  occurrences. Published copies agree with it. `refines: LS-R15`
- **LS.CONTRIB.COMM.MEET-R02 No paid dependency:** Required publication
  destinations support automatic updates without additional paid services or
  manual duplication. `refines: LS.CONTRIB.COMM-R01`
- **LS.CONTRIB.COMM.MEET-R03 Canonical room:** Every published meeting uses
  one stable room alias whose redirect target is verified. Changing the room
  does not invalidate previously shared links. Guest entry is not a release
  prerequisite. `refines: LS.CONTRIB.COMM-R01`
- **LS.CONTRIB.COMM.MEET-R04 Canonical information:** The docs page presents
  the next two meetings and is linked from calendar events. Schedule edits
  appear within minutes without rebuilding docs. Failed reads are explicit.
  `refines: LS.CONTRIB.COMM-R03`
- **LS.CONTRIB.COMM.MEET-R05 Explained changes:** Rescheduling and cancellation
  require a public reason. Rescheduling preserves identity and resets later
  cadence. Cancellation requires two explicitly chosen next dates.
- **LS.CONTRIB.COMM.MEET-R06 Observable publication:** Repeated publication
  creates no duplicates and maintains two upcoming meetings. A reusable issue
  reports changed failures, suppresses unchanged repeats, and closes on
  recovery. A private calendar verifies the full lifecycle before activation.
- **LS.CONTRIB.COMM.MEET-R07 Recoverable credentials:** Publishing credentials
  have a backup in shared 1Password and limited calendar permissions.
- **LS.CONTRIB.COMM.MEET-R08 Verified migration:** Verify the replacement
  before retiring future legacy invitations. Preserve history and deliver
  replacement links through Calendar notifications, using an update to the
  next old occurrence if necessary. Completed checks permit activation
  without an additional discretionary rollout gate.
