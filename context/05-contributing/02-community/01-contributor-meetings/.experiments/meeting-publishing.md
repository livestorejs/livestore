# Contributor meeting publishing options and evidence

## Question

How can one schedule reach the required public surfaces without an additional
paid subscription or manual duplication?

## Evidence checked (2026-09-24)

- The organizer's existing Google Calendar event, viewed in Notion Calendar,
  was `LiveStore Contrib Sync`, 18:00–19:00 Europe/Berlin. It then said
  "Every week on Thu" and includes the LiveStore Riverside Studio link. A
  separate browser visit reached the "Welcome to LiveStore" studio page; a
  full guest join was not attempted.
- [Google Calendar API recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents): a series can have exceptions, but changing many instances creates clutter and notifications. Individual upcoming events fit a cadence that moves often.
- [Discord scheduled event API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild-scheduled-event.mdx): supports creating and modifying scheduled events, including recurrence rules. A bot with event permissions can publish individual occurrences.
- [Luma API getting started](https://docs.luma.com/reference/getting-started-with-your-api): API use requires Luma Plus. It cannot be a required publishing path under LS.CONTRIB.COMM.MEET-R02.
- [Luma cloning](https://help.luma.com/p/cloning-events): a host can clone events for recurring dates without an API key. Guest lists and blasts are not cloned.
- [Luma iCal syncing](https://help.luma.com/p/ical-syncing): calendar subscriptions reflect changes, but Google may refresh only every 12–24 hours. This is too slow to serve as the only propagation path for a late schedule change.
- [Riverside studio links](https://support.riverside.com/hc/en-us/articles/24568348830237-Understanding-the-different-studio-links): a Studio link is reusable and does not expire, and Riverside currently lists up to 100 guests for it; scheduled-session links are time-limited, and audience links serve a different role. Reuse the Studio link rather than scheduling a second Riverside series.
- [Riverside custom URLs](https://support.riverside.com/hc/en-us/articles/15498306481693-Customize-your-studio-s-URL): branded Riverside URLs require Grow, Webinar, or Business. Use a redirect on the existing docs domain for a memorable public URL without making that feature a dependency.

## Conclusion

The approved implementation keeps the canonical cadence and exceptions in
the Community VRS subtree, exposes the next two meetings on the docs site,
and reconciles a dedicated public Google calendar through its API. Luma is
excluded from contributor-sync publishing because manual duplication violates
the requested operational simplicity. Office-hours use remains separate.
Discord automation follows the contrib bot work; server-wide scheduled events
cannot serve as test-channel-only experiments.

The existing personal-calendar Google series must be reconciled carefully so its invited
guests receive the change and no duplicate fortnightly events are created.

## Refreshed legacy-series inspection (2026-09-25)

The live personal-calendar series now runs every two weeks at 19:00 Berlin,
with October 8 and 22 occurrences and four invitees. This supersedes the earlier
weekly 18:00 observation. Retire its future invitations only after the replacement
is verified; preserve history and notify invitees about the new calendar.

## Live Google lifecycle verification (2026-09-25)

The local publisher tests exercise cancellation restoration and moving a
previously past event into the future under its existing ID. The future-event
listing alone misses both cases, so publication also looks up each absent
desired identity. The [Google event resource contract](https://developers.google.com/workspace/calendar/api/v3/reference/events)
documents that cancelled organizer events retain details for restoration and
that direct event retrieval returns cancelled entries. The publisher patches
owned entries to `confirmed` with their concurrency token. Missing ownership
metadata fails closed.

The actual publisher adapter ran against the disposable private calendar with
the approved service-account signing key and enabled Calendar API. Every step
read back Google state, required exactly two active events, and verified that
replanning produced no further changes:

| Scenario | Applied operations | Result |
| --- | --- | --- |
| Initial publication | Create two | Two expected stable IDs |
| Repeat | None | Idempotent |
| Reschedule | Update two | Original IDs retained |
| Cancel with replacement dates | Update, create, delete | Two replacement occurrences |
| Restore original schedule | Update two, delete | Original IDs restored after deletion |
| Repeat restored schedule | None | Idempotent |

Cleanup then deleted the remaining owned test events and confirmed zero active
events. The disposable calendar container still requires removal. This directly
verifies Google's organizer-calendar cancellation/restoration behavior with the
same adapter used by the workflow; no production events were published. The
local reproducible harness is `tmp/meeting-live-e2e.mjs` (ignored, receives its
credential through the environment). The GitHub Actions credential is stored;
backup into the shared LiveStore 1Password vault has been created, with the
concealed field metadata and exact JSON readback verified. The downloaded key
copy was removed. The
test calendar writer grant was revoked and verified after cleanup. A separate
read-only production plan proposed exactly two creations, October 8 and 22
at 17:00–18:00 UTC; it did not publish them.

## Validation still needed

The accepted cadence is 19:00 Europe/Berlin, every 14 days from 2026-09-24.
Exercise create, reschedule, cancellation, and retry behavior, then verify
production docs freshness, calendar permissions and subscription, event
backlinks, and the Riverside redirect target. Hosted guest entry is not a
rollout gate under the accepted interview decision. The
[rollout delta](../.delta/DELTA-001-meeting-publication.md) remains open until
live evidence establishes activation; local tests alone do not establish it.
