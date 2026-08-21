# DELTA-001 — Store sync status omits backend confirmation

Status: resolved (2026-08-21)

## Divergence

The Store sync-status contract distinguishes session→leader delivery from
leader→backend confirmation. The shipping `SyncStatus` exposes only
`localHead`, `upstreamHead`, `pendingCount`, and `isSynced`, all derived from
session→leader state.

## VRS

Diverges from the [sync-status contract](../spec.md#sync-status).

## Close Condition

Close when `SyncStatus` exposes `backendHead`, `backendPendingCount`, and
`isBackendSynced`; synchronous snapshots and subscriptions combine session and
leader observations conservatively; and regression tests cover a session that
is synced to its leader while the leader still awaits backend confirmation.

## Resolution

`SyncStatus` now combines the session processor's state with a Store-local cache
of the leader processor's state. The cache is seeded during Store boot and kept
current through the existing leader sync-state stream, so synchronous reads do
not add an on-demand RPC. `isBackendSynced` requires both pending counts to be
zero and the cached leader head to cover the leader head already observed by the
session. Regression tests cover backend-pending delivery and a deliberately
stale leader observation.
