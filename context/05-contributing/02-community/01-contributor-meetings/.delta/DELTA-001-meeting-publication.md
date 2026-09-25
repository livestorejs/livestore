# DELTA-001 — Contributor meeting publishing is not verified live

Status: open.

The Contributor Meetings [spec](../spec.md) defines the repository schedule, canonical
docs page, reusable Riverside alias, and a dedicated public Google calendar.
The checked-in implementation does not establish production activation.

The dedicated public Google calendar has been created and public subscription
verified. The Google Cloud project `livestore-meetings` exists without billing.
Calendar API activation is pending the user's Google terms confirmation.
The dedicated public calendar grants the publisher calendar-only writer access;
its invitation setting is verified after reload as "Do not show invitations".
Service-account credentials have not been created. The legacy series remains
untouched. These provisioning steps do not establish event publication.

Metadata access to the existing shared 1Password vault **LiveStore** is
confirmed. The disposable private test calendar
`60dbecfd6343397d67788b5e29bca1cc0ce63888e37cfd448c14eecbc40f4f73@group.calendar.google.com`
has been created. Its writer grant to
`meeting-publisher@livestore-meetings.iam.gserviceaccount.com` is verified.
No signing key exists yet, and API lifecycle tests have not run because API
terms confirmation is still pending. Remove the disposable calendar after
those tests and record cleanup before closing this delta.

The last inspected personal-calendar series was weekly at 18:00 Berlin.
The intended schedule is biweekly at 19:00 Berlin. Do not retire that series
until its replacement is verified. Riverside verification covers the redirect
target; guest entry is not a rollout prerequisite.

Close this delta only after recording evidence that:

- The dedicated stable docs release serves the contributor-sync page and
  `/meet` redirect, and the page reads the current `main` schedule revision.
- The room alias redirects to the intended reusable Riverside Studio URL.
- A temporary private calendar passes lifecycle tests and is cleaned up.
- The dedicated Google calendar is publicly subscribable, its writer
  credential is configured with shared 1Password backup, and the workflow is
  enabled after the docs gate. The reusable failure issue recovers correctly.
- The next two events agree with the schedule and link back to the docs page
  and room. Repeated publication preserves their identities.
- Future instances of the old weekly series have ended, its past instances
  remain intact, and Calendar notifications deliver the replacement links.

Discord automation and contributor-sync Luma publishing are outside this
rollout. Office-hours Luma use is unaffected. See the
[setup guide](../setup-guide.md) for the activation order.
