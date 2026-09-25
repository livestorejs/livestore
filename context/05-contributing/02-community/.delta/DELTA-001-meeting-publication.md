# DELTA-001 — Contributor meeting publishing is not verified live

Status: open.

The Community [spec](../spec.md) defines the repository schedule, canonical
docs page, reusable Riverside alias, and a dedicated public Google calendar.
The checked-in implementation does not establish production activation.

The dedicated public Google calendar has been created and public subscription
verified. The Google Cloud project `livestore-meetings` exists without billing.
Calendar API activation is pending the user's Google terms confirmation;
service-account credentials have not been created. The legacy series remains
untouched. These provisioning steps do not establish event publication.

The last inspected personal-calendar series was weekly at 18:00 Berlin.
The intended schedule is biweekly at 19:00 Berlin. Do not retire that series
until its replacement is verified. A Riverside welcome page was observed;
a complete guest entry has not been verified by that observation.

Close this delta only after recording evidence that:

- The dedicated stable docs release serves the contributor-sync page and
  `/meet` redirect, and the page reads the current `main` schedule revision.
- A guest can enter the intended Riverside room when the host opens it.
- The dedicated Google calendar is publicly subscribable, its writer
  credential is configured, and the workflow is enabled after the docs gate.
- The next two events agree with the schedule and link back to the docs page
  and room. Repeated publication preserves their identities.
- Future instances of the old weekly series have ended, its past instances
  remain intact, and current invitees have received the replacement links.

Discord automation and contributor-sync Luma publishing are outside this
rollout. Office-hours Luma use is unaffected. See the
[setup guide](../setup-guide.md) for the activation order.
