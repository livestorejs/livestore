# Contributor Meetings — Spec

This document specifies contributor meeting scheduling and publication. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Contributor Meeting Schedule (LS.CONTRIB.COMM.MEET-R01, R02, R05)

**Maturity: experimental**

```text
meeting-schedule.json on main
  ├──► docs page reads schedule on each visit
  └──► GitHub workflow ──► dedicated public Google calendar
                               └──► canonical docs page + /meet
```

[`meeting-schedule.json`](../meeting-schedule.json) is the operational authority
for meeting times. This node owns its contract. The docs page is the canonical
public information source; calendar events are derived copies. The default
cadence is every 14 calendar days, anchored on **2026-09-24**, at **19:00
Europe/Berlin** for 60 minutes. Winter meetings keep the same local start
time. The anchor is a cadence reference and does not assert that the meeting
was held. Its first following dates are 2026-10-08 and 2026-10-22.

```ts
type MeetingSchedule = {
  version: 1
  anchor: { occurrence: 0; date: string }
  intervalDays: 14
  localStart: string
  durationMinutes: number
  timeZone: 'Europe/Berlin'
  calendarId?: string
  changes: Array<
    | { kind: 'reschedule'; occurrence: number; date: string; localStart?: string; note: string }
    | { kind: 'cancel'; occurrence: number; nextDates: [string, string]; note: string }
  >
}
```

Dates use `YYYY-MM-DD`. Occurrences are nonnegative integer ordinals relative
to the anchor, with zero identifying the anchor itself. This repository owns
the occurrence namespace. Calendar identities derive from the ordinal, never
from a mutable date. Moving an occurrence retains its identity and resets the
14-day cadence for later occurrences. An optional `localStart` (`HH:mm`)
changes the time for that occurrence and later ones. The base schedule is
immutable after launch; changes use noted entries. Cancellation preserves the cancelled
occurrence and assigns its two explicit `nextDates` to the next two ordinals;
the cadence resumes 14 days after the second. Duplicate change entries,
overlapping cancellation replacement ranges, date collisions, and empty
public notes are invalid. `calendarId` is absent until the dedicated public
calendar is provisioned; readers must not manufacture a subscription URL.

Cancellation notices remain visible until the affected meeting's end time.
Reschedule notices remain visible through the later of the original and new
end times. The rolling public window contains two meetings whose end times
have not passed, excluding cancelled occurrences, so a meeting in progress
stays discoverable. Historical occurrences are retained. If a published future
event is rescheduled into the past, reconciliation updates its existing ID
before it leaves the future listing. Missing historical events are not backfilled;
the two-event limit applies to upcoming events. Explicit cancellations still
remove the cancelled occurrence from Google Calendar.

Luma is excluded from contributor-sync publishing because its API requires
a paid plan. The separate office-hours Luma calendar remains a community
surface. Discord automation is deferred to
[livestore-contrib PR #55](https://github.com/livestorejs/livestore-contrib/pull/55).
Any interim message experiments use the real server's test channel. Discord
scheduled events are server-wide and cannot be confined to that channel.

## Public Page and Room (LS.CONTRIB.COMM.MEET-R03, R04)

**Maturity: experimental**

The community page links to
`https://docs.livestore.dev/misc/contributor-sync/`. On each visit, this page
reads the public schedule from the core repository's `main` branch. The raw
file cache can delay visibility by approximately five minutes. The page
computes the next two meetings, shows change reasons and current cancellation
notices, and offers individual calendar additions, a subscription to the
dedicated LiveStore Google calendar, and the room link. A failed schedule read
shows an explicit unavailable state. A standing notice explains that saved
one-off calendar copies do not update automatically and subscriptions can
refresh slowly.

`https://docs.livestore.dev/meet` is a temporary redirect to the reusable
LiveStore Riverside **Studio link**. It is used by the page and calendar
events so changing the room does not invalidate shared links. A Studio link
supports participating guests; an audience link is not an equivalent room.
Riverside scheduled-session links and paid custom URLs are unnecessary.
Verification checks that the redirect reaches the intended Studio URL. Guest
entry into a hosted room is not an activation gate.

Production docs follows stable releases. Bootstrap this page and redirect in
a dedicated stable docs release; later schedule-only edits use the runtime
read and do not require a new docs build or publication of unrelated `main`
documentation.

## Calendar Publication (LS.CONTRIB.COMM.MEET-R02, R06)

**Maturity: experimental**

```text
schedule merge / daily timer / manual dispatch
  → validate schedule
  → verify production page reads the current schedule revision
  → reconcile two upcoming Google events
  → verify destination state or fail the workflow
```

The GitHub workflow is disabled until production bootstrap is verified. It
uses a service-account credential stored in Actions secrets, with writer
access only to the dedicated public calendar, with a recoverable backup in
shared 1Password. It creates individual events
without an attendee roster. Each description links to the canonical docs
page and room, and includes any change reason. Stable event IDs make retries
idempotent. Publication looks up desired identities omitted by the future-event
listing, restoring owned cancelled events or moving past copies in place. An
event whose ownership cannot be established fails publication. Managed future
events are updated or cancelled as required;
unrelated calendar events and historical meetings are preserved.

Publication is bounded and destination failures fail the workflow visibly.
A single reusable GitHub issue reports publication failures. Open or reopen it
on failure, update it when the failure changes, suppress repeated unchanged
failure reports, and close it after successful verification. Temporary private
calendars exercise the full create, move, cancel, restore, retry, and cleanup
lifecycle before production activation.
Validation and publication use the repository's Minimal Setup with a frozen
dependency install. Only publication resolves the managed Playwright wrapper
from the exact browser, Nixpkgs, and wrapper revisions in `devenv.lock`;
it does not bootstrap the full development environment or megarepo. Browser
resolution or production verification failure prevents calendar writes.
The docs page remains the authoritative public schedule during a Google
failure and warns that calendar copies may lag. Standard Calendar API use at
this scale must not introduce additional fees; if free access becomes
unavailable, publication must fail rather than opt into a paid service.

The existing personal-calendar series is retired only after the page,
room, public calendar subscription, event backlinks, and workflow are verified
live. End future instances while preserving history, and notify its current
invitees through Google Calendar with the canonical page and replacement
subscription. If truncating the series does not deliver those links, update
the next old occurrence with the migration note and notify its invitees before
retiring it. No separate email or Discord announcement is required. Once these
checks pass, activate without a discretionary rollout approval. Operational steps
are in [setup-guide.md](./setup-guide.md). Unverified activation is tracked in
[the rollout delta](./.delta/DELTA-001-meeting-publication.md).

## Public Compatibility

The schedule JSON stays at its established parent path because deployed pages
read that URL. This subtree owns the contract; moving its documentation does
not relocate the public data resource.
