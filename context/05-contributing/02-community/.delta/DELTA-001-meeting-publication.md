# DELTA-001 — Contributor meeting publishing is not reconciled

Status: open.

The Community [spec](../spec.md) defines a repository-owned contributor
meeting schedule and copies on Google Calendar, Discord, and Luma. The live
events were previously managed independently. This change records the intended
authority and publishes the cadence on the community page, but it does not
connect a reconciliation command, record destination event IDs, deploy the
canonical Riverside room redirect, or verify existing live events. In
particular, no Google, Discord, or Luma event was created or changed by this
documentation update.

Close when the organizer confirms the remaining publishing accounts and a
guest join through the Riverside Studio, the free-tier publishing workflow
is in the repo, and the next
published occurrences have been checked against that schedule on every
destination. Existing event IDs and Luma URLs must be recorded before any
automatic update to avoid duplicates.
