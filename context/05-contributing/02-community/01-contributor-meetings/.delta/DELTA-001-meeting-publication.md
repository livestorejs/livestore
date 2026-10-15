# DELTA-001 — Contributor meeting publication verified live

Status: closed, 2026-09-25.

The repository schedule, canonical docs page, Riverside alias, and dedicated
public Google calendar now agree. The legacy personal-calendar invitations
have been retired while historical occurrences remain.

## Production docs

[Core PR #1635](https://github.com/livestorejs/livestore/pull/1635) merged as
`1aab755c02a7492da844f665b6c3c115eef33f90` after required checks passed.
[Stable docs PR #1639](https://github.com/livestorejs/livestore/pull/1639)
merged as `3247f2bc9588f0d26501b92caa4497f2aa5efb81`.
[Deployment 36173267083](https://github.com/livestorejs/livestore/actions/runs/36173267083)
succeeded from that stable commit; its docs deployment job took 24m47s.

The production page reports `Contributor Sync | LiveStore 0.4.0` and ready
schedule SHA-256 `fc9f113d3b645b0c25545bc0df064d459c2927bf6707f8bd5f21b50e2e33a8d5`.
It presents `lscontrib00000001` and `lscontrib00000002` on October 8 and 22,
2026, at 17:00 UTC (19:00 Berlin). Google addition templates contain the
canonical page, room, and [contributor chat](https://discord.com/channels/1154415661842452532/1344991859805786142).
Subscription and iCal links use the expected public calendar ID. `/meet`
returns HTTP 302 to exactly
`https://riverside.com/studio/livestore?t=5e1a91673f40e01c9054`.

## Publication and recovery

The publishing variable was enabled after the production checks.
[Run 36176007769](https://github.com/livestorejs/livestore/actions/runs/36176007769)
passed validation, publication, and reporting. It created the two expected
IDs and reported `Verified 2` at 18:52:44 UTC. An anonymous ICS read confirmed
exactly two events with UIDs `lscontrib00000001@google.com` and
`lscontrib00000002@google.com`, October 8 and 22 at 17:00–18:00 UTC, with the
canonical docs, room, and chat links in their descriptions.

[Repeat run 36176299505](https://github.com/livestorejs/livestore/actions/runs/36176299505)
passed all three jobs, reported `actions: []`, and verified two events at
18:55:29 UTC. The reporting job demonstrated real GitHub API access. Automated
tests cover failure-issue creation, reopening, unchanged-failure suppression,
and closure; no public outage was manufactured to exercise that lifecycle.

The daily timer first fired in
[scheduled run 36241425870](https://github.com/livestorejs/livestore/actions/runs/36241425870),
created at 12:16:57 UTC on 2026-09-26 for the 07:23 UTC cron; this repository's
scheduled workflows typically start five to six hours late. It passed all
three jobs, verified the production page, room redirect, and public calendar
for the same schedule SHA-256, reported `actions: []`, and verified two
upcoming events.

The Calendar API is enabled without an added billing dependency. The service
account has calendar-only writer access, its key is in Actions secrets, and
the shared LiveStore 1Password backup passed exact JSON readback verification.
The downloaded copy was removed. Private-calendar tests verified create,
repeat, reschedule, cancellation, restoration with original IDs, and repeated
restoration. Cleanup verified zero active test events and revoked writer
access. A later browser inspection found the disposable calendar absent while
the production calendar remained; no agent-performed container deletion is
claimed. See [experiment evidence](../.experiments/meeting-publishing.md).

## Legacy invitation migration

At approximately 19:00 UTC, the October 8 legacy occurrence was updated with
a migration reason, canonical page, subscription, cadence, room, and chat.
The Calendar **Send** action was selected, **Event saved** appeared, and a
reload confirmed the description. That occurrence was then cancelled with
**Send** and a note explicitly stating that the meeting still happens.

The October 22 legacy occurrence was removed using **This and following
events**, with **Send** and cancellation text containing the reason and
replacement links. Calendar displayed **Event deleted** and **Open trash**.
A fresh search for the legacy title returned only July 23, August 6, August
20, September 3, and September 17, 2026, with no future legacy results.
The historical series was distinct from the future series, and those past
occurrences remained visible.

These observations establish Calendar send actions and saved changes, not
recipient delivery or read receipts. No separate emails or Discord posts were
sent. Office-hours Luma use and deferred Discord automation are unchanged.
