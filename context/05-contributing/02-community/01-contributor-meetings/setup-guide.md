# Contributor meeting publishing — setup and operation

This guide implements the Contributor Meetings [spec](./spec.md). Track unverified live
steps in the [rollout delta](./.delta/DELTA-001-meeting-publication.md).

## Provision the calendar

1. Create a dedicated Google calendar named **LiveStore**
   under a maintained organizer account. Set its time zone to Europe/Berlin
   and enable public access to event details. Do not reuse the organizer's
   personal calendar.
2. In the dedicated `livestore-meetings` Google Cloud project, enable the Calendar API and create
   a dedicated publishing service account. Share only the new calendar with
   its email address with **Make changes to events** (`writer`) permission.
   Do not grant domain-wide delegation or project-wide administrator roles.
3. Create a service-account JSON key and store it as the repository Actions
   secret `MEETING_GOOGLE_SERVICE_ACCOUNT_JSON`. Never commit or print it.
   Keep a recoverable copy in shared 1Password. Rotate by
   replacing the secret and verifying a run before revoking the old key.
4. Put the public calendar ID in `meeting-schedule.json` as `calendarId`.
   It is public configuration, not a secret. Verify that an anonymous viewer
   can open the calendar and subscribe to it.
5. Leave the repository variable
   `CONTRIBUTOR_MEETING_PUBLISHING_ENABLED` absent or set to `false` until
   the stable docs bootstrap below is verified.

Use only existing free access. Do not enable a paid subscription or a new
billing dependency to make publication work.

## Bootstrap and activate

1. Merge the reviewed implementation and schedule into `main`. Release the
   contributor-sync page and `/meet` redirect through a dedicated stable docs
   release using the existing docs release process. Do not point production
   docs at unrelated unreleased `main` changes.
2. Open `https://docs.livestore.dev/misc/contributor-sync/` in a fresh browser.
   Verify the displayed meetings against the repository schedule, public
   change notes, and the calendar subscription link. Confirm `/meet` redirects
   to the intended LiveStore Riverside Studio.
3. Verify the create, move, cancel, restore, repeated-run, and cleanup lifecycle
   on a temporary private calendar using the same publisher. Remove the test
   calendar after recording results. Riverside verification is the redirect
   target check above; entering a hosted room is not an activation gate.
4. Run `node scripts/src/meetings/publish.ts --validate`, then
   `node docs/src/utils/verify-contributor-meeting.ts` to check the live page. Run
   `node scripts/src/meetings/publish.ts` with the publishing credential
   available to preview Google changes without writing. Review that
   it targets only the dedicated calendar and the expected next two meetings.
5. Set `CONTRIBUTOR_MEETING_PUBLISHING_ENABLED` to `true` and manually dispatch
   the publishing workflow. Its production-page check must pass before Google
   writes. Verify the resulting public events, dates, duration, time zone,
   canonical-page backlink, and room link. Repeat once to confirm no duplicate
   events or unnecessary changes.
6. Verify subscription from a separate viewer. Only then end future instances
   of the old weekly personal-calendar series, preserving past instances.
   Notify its current invitees with the canonical page and new subscription
   link through Calendar notifications. If truncating the series does not
   deliver the migration links, update the next old occurrence with the note
   and notify its invitees before retiring it. Do not send a separate email
   or Discord announcement. Record evidence and close the rollout delta.

Once these checks pass, activate without an additional discretionary rollout
approval. A reusable GitHub issue opens or reopens on a publishing failure,
updates only when that failure changes, and closes after successful recovery.
Repeated unchanged failures do not produce repeated issue messages.

## Change the schedule

Edit `meeting-schedule.json` in a reviewed pull request. Keep its base schedule
immutable after launch and express date/time changes using `changes` entries
with public notes. A reschedule's optional `localStart` changes the local time
for that and subsequent occurrences. The website reads
`main` at runtime, and merges trigger Google reconciliation. Allow roughly
five minutes for the raw-file cache to refresh. Inspect the workflow result
after each change; a merged edit alone does not prove calendar publication.

Occurrence zero denotes September 24, 2026. Ordinals persist when dates move.
For example, moving occurrence one changes October 8 and reanchors later
meetings:

```json
{ "kind": "reschedule", "occurrence": 1, "date": "2026-10-15", "note": "Moved to accommodate contributor availability." }
```

Cancelling occurrence one requires choosing the next two dates explicitly:

```json
{ "kind": "cancel", "occurrence": 1, "nextDates": ["2026-10-22", "2026-11-05"], "note": "Cancelled because the host is unavailable." }
```

These are alternative examples, not two changes to apply together. Preserve
historical changes. Use short public reasons without private participant
details. Never edit the Google copy independently to change the schedule.

## Failures and recovery

The workflow validates with Node.js 24, Bun 1.3.13, and the exact pnpm version
declared in `package.json`, using `scripts/bootstrap-minimal.sh`. Publication
additionally builds the managed Playwright wrapper from `devenv.lock` through
`scripts/src/meetings/resolve-playwright.sh`. A cold full development-environment
bootstrap is not required for schedule updates. Job deadlines are ten minutes
for validation and fifteen minutes for publication; investigate a slow setup
phase before increasing either deadline.

Disable `CONTRIBUTOR_MEETING_PUBLISHING_ENABLED` to stop Google writes during
an incident. Keep the public repository schedule accurate. Fix the reported
failure and rerun manually; stable event identities make retries safe. A
Google failure leaves the website authoritative, with its standing warning
that calendar copies may lag. A failed schedule read renders an unavailable
state instead of presenting a fabricated or silently stale schedule.

The daily workflow replenishes the two-meeting window. GitHub schedule delays
can delay Google replenishment; the public page computes its window on each
visit. Monitor failed workflow notifications and verify a manual run after
credential rotation or service restoration. Individual calendar copies saved
by visitors cannot be updated by this publisher; direct visitors to the
canonical page and explain that subscription refresh timing is client-owned.

Keep Discord message experiments in the real server's test channel. Production
Discord automation follows
[contrib PR #55](https://github.com/livestorejs/livestore-contrib/pull/55).
