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
| Contributor sync | `/misc/contributor-sync/`, recordings on the community page | contributor coordination |
| Conference talks / podcasts | linked from the community page | outreach |

## Support Model (LS.CONTRIB.COMM-R02)

Non-sponsor support is best-effort via Discord and GitHub issues (minimal
repro required, LS.CONTRIB-R06). There is no SLA. Sponsors additionally get
the published benefits owned by `06-sustainability/` (LS.SUST-R05).

## Derived Pages (LS.CONTRIB.COMM-R03)

`docs/src/content/docs/misc/community.mdx` renders the surfaces table; the
docs FAQ's community/support statements follow this node.

## Contributor Sync Schedule

The public reference is `https://docs.livestore.dev/misc/contributor-sync/`.
The page reads the versioned schedule from the core repository's `main`
branch at runtime and displays exactly two upcoming meetings, including
public reasons for cancellation or rescheduling. The default cadence is
every 14 days from September 24, 2026 at 19:00 Europe/Berlin for one hour.
The reusable `/meet` URL redirects to the existing LiveStore Riverside Studio.

The schedule and Google Calendar publisher are maintained on `main` in
[the current community specification](https://github.com/livestorejs/livestore/blob/main/context/05-contributing/02-community/spec.md).
This stable docs release contains only the page and its compatible schedule
reader; changes to meeting dates do not require another docs deployment.
The page explicitly reports an unavailable schedule rather than showing stale
dates when fetching or validation fails. Individual calendar downloads are
static copies; public-calendar subscriptions may refresh slowly.
