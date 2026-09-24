# Contributor meeting publishing options

## Question

How can one schedule reach Google Calendar, Discord, and the LiveStore Luma
calendar without an additional paid subscription?

## Evidence checked (2026-09-24)

- The organizer's existing Google Calendar event, viewed in Notion Calendar,
  is `LiveStore Contrib Sync`, 18:00–19:00 Europe/Berlin. It currently says
  "Every week on Thu" and includes the LiveStore Riverside Studio link. A
  separate browser visit reached the "Welcome to LiveStore" studio page; a
  full guest join was not attempted.
- [Google Calendar API recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents): a series can have exceptions, but changing many instances creates clutter and notifications. Individual upcoming events fit a cadence that moves often.
- [Discord scheduled event API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild-scheduled-event.mdx): supports creating and modifying scheduled events, including recurrence rules. A bot with event permissions can publish individual occurrences.
- [Luma API getting started](https://docs.luma.com/reference/getting-started-with-your-api): API use requires Luma Plus. It cannot be a required publishing path under LS.CONTRIB.COMM-R05.
- [Luma cloning](https://help.luma.com/p/cloning-events): a host can clone events for recurring dates without an API key. Guest lists and blasts are not cloned.
- [Luma iCal syncing](https://help.luma.com/p/ical-syncing): calendar subscriptions reflect changes, but Google may refresh only every 12–24 hours. This is too slow to serve as the only propagation path for a late schedule change.
- [Riverside studio links](https://support.riverside.com/hc/en-us/articles/24568348830237-Understanding-the-different-studio-links): a Studio link is reusable and does not expire, and Riverside currently lists up to 100 guests for it; scheduled-session links are time-limited, and audience links serve a different role. Reuse the Studio link rather than scheduling a second Riverside series.
- [Riverside custom URLs](https://support.riverside.com/hc/en-us/articles/15498306481693-Customize-your-studio-s-URL): branded Riverside URLs require Grow, Webinar, or Business. Use a redirect on the existing docs domain for a memorable public URL without making that feature a dependency.

## Conclusion

Keep the canonical cadence and exceptions in the Community VRS subtree. A
free-tier workflow can reconcile Google and Discord through their APIs and
make Luma a checked manual copy. Publish only a short horizon so a cadence
change does not require canceling many future events. Do not infer success
from creating an event in one destination; verify all published copies.

The existing weekly Google series must be reconciled carefully so its invited
guests receive the change and no duplicate fortnightly events are created.

## Validation still needed

Confirm the intended cadence anchor, calendar and Discord ownership, access
to the chosen Google calendar and Discord bot, and the exact Luma calendar
permissions. Then exercise create, move, and skip on the actual publishing
surfaces before treating reconciliation as active.
