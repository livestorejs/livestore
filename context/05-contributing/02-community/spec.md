# Community — Spec

This document specifies the public community surfaces. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Surfaces (LS.CONTRIB.COMM-R01)

| Surface | Where | Purpose |
| --- | --- | --- |
| Discord | invite via docs site (`DISCORD_INVITE_URL`) | community help, `#contrib` pre-coordination, sponsor channels |
| Office hours | `lu.ma/livestore`, recordings on the community page | live Q&A with the maintainer |
| Contributor sync | recordings embedded on the community page | contributor coordination |
| Conference talks / podcasts | linked from the community page | outreach |

## Contributor Meeting Schedule (LS.CONTRIB.COMM-R04, R05)

```text
meeting-schedule.json beside this VRS spec
  ├──► community page (cadence and calendar link)
  ├──► Google Calendar event
  ├──► Discord scheduled event
  └──► Luma event on the LiveStore calendar (manual publishing)
```

[`meeting-schedule.json`](./meeting-schedule.json) is the authority for
*when* each contributor meeting happens. This spec owns the schedule format
and publishing rules. Events on Google Calendar, Discord, and Luma are
published copies, not places to independently change the meeting time.
The regular target is every 14 days
on Thursday at 18:00 `Europe/Berlin`, anchored on **2026-09-24**. `CEST` is
only the summer offset; winter meetings remain at 18:00 local time. The
meeting lasts one hour. The following occurrences are 2026-10-08,
2026-10-22, 2026-11-05, and every 14 days thereafter unless explicitly moved
or skipped. The anchor is a
cadence reference; it does not assert that an event on 2026-09-24 was
published or held.

The versioned schedule records the anchor date, interval in calendar days,
local start time, duration, time zone, join location, and dated overrides for
moves or skips. The anchor and `intervalDays` select occurrence dates; each
date's `localStart` is interpreted in `timeZone`, so daylight saving changes
do not shift the wall-clock meeting time. The current data shape is:

```ts
type MeetingSchedule = {
  anchorDate: string // YYYY-MM-DD; occurrence identity anchor
  intervalDays: 14
  localStart: string // HH:mm in timeZone
  durationMinutes: number // positive integer
  timeZone: 'Europe/Berlin'
  joinUrl: 'https://livestore.dev/meet'
  overrides: Array<
    | { date: string; action: 'skip' }
    | { date: string; action: 'move'; newDate: string; newLocalStart?: string }
  >
}
```

`date` identifies the original occurrence even when it moves. A moved
occurrence keeps its existing destination event IDs. At most one override
may exist per original date; `newDate` cannot collide with another live
occurrence. `overrides` is currently empty. Publish a
short rolling window of individual meetings rather than indefinitely
recurring series. A reconciliation command should preview intended changes,
create or update the corresponding Google and Discord events, retain their
IDs for later updates, and report missing or divergent copies. A moved meeting
updates existing event IDs so invite and RSVP links remain valid. The command
must not silently recreate an event whose recorded ID is missing.

Luma's event API requires a paid subscription. Without one, an organizer
creates or updates each Luma event using the schedule, records its URL, and
checks its time and join location against the schedule before announcing it.
The command reports an unverified or missing Luma copy; it does not claim
complete publication. The LiveStore Luma calendar remains a public discovery
and registration surface. Avoid requiring attendees to subscribe to both the
Luma feed and an independently mirrored Google calendar, which would show
duplicate events.

## Canonical Video Room (LS.CONTRIB.COMM-R06)

The contributor meeting uses a reusable Riverside **Studio link**, copied
from its Invite People panel, for participants to join the conversation.
Riverside documents that this link does not expire and is intended for
recurring sessions. An audience link is for watching a stream and must not be
published as the interactive meeting-room link. Scheduled Riverside sessions
use different, time-limited links; the recurring Studio link avoids a second
event schedule inside Riverside.

Expose the room to attendees through a stable `https://livestore.dev/meet`
temporary redirect owned by the docs deployment. Its target is the existing
LiveStore Riverside Studio link used by the organizer's calendar series;
the landing page identifies the LiveStore room. Google, Discord, Luma, and
the community page all use that alias, so the Riverside target can change
without editing every event.
The room must be checked through a guest join before treating this as
fully verified (LS.CONTRIB.COMM-DQ4). A custom Riverside URL is
optional and is not required because Riverside restricts that feature to
paid plans. The alias uses the existing docs hosting.

Changes to an already announced occurrence require updating every published
copy and sending a clear announcement through the community channel. The
community page links to the current meeting schedule and LiveStore Luma
calendar; it must not carry a separately maintained date list.

## Support Model (LS.CONTRIB.COMM-R02)

Non-sponsor support is best-effort via Discord and GitHub issues (minimal
repro required, LS.CONTRIB-R06). There is no SLA. Sponsors additionally get
the published benefits owned by `06-sustainability/` (LS.SUST-R05).

## Derived Pages (LS.CONTRIB.COMM-R03)

`docs/src/content/docs/misc/community.mdx` renders the surfaces table; the
docs FAQ's community/support statements follow this node.

## Open Design Questions

- **LS.CONTRIB.COMM-DQ3 Event ownership:** The existing Google Calendar series
  is on the organizer's personal calendar. Which Discord guild/channel and
  Luma calendar permissions should the reconciler use? Resolve before
  connecting the command to live accounts.
- **LS.CONTRIB.COMM-DQ4 Riverside guest verification:** The current Studio
  link reaches a LiveStore welcome page. Verify that a new participant can
  pass the lobby and enter as a guest when the host opens the room.
