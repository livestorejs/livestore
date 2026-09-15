# DELTA-001 — Store sync status omits backend confirmation

Status: open

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
