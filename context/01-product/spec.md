# Product — Spec

This document specifies LiveStore's positioning and adoption guidance. It
builds on [requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: the positioning statement, fit/non-fit criteria, comparison stance,
and the evaluation exercise. Does not define system behavior (`02-system/`)
or documentation mechanics (`04-docs/`).

## Positioning Statement

LiveStore is an event-sourced, SQLite-backed, client-centric data layer for
local-first apps: instant synchronous queries against a real local database,
with sync as merged event histories rather than reconciled state.

## Fit Matrix

| Fit (LS.PROD-R02) | Non-fit (LS.PROD-R01) |
| --- | --- |
| High-performance productivity apps (web, desktop, mobile) | Existing database is the source of truth (→ Zero, ElectricSQL) |
| AI agents needing durable, auditable local state | Highly connected cross-user data (social network, marketplace) |
| Apps needing solid offline support | Batteries-included full-stack expectations (→ Jazz, Instant) |
| Apps needing audit logs / replayable history | Bundle-size-critical apps (SQLite adds a few hundred kB) |
| | Developers who haven't yet hit these problems |

Operating envelope (LS.PROD-R03): data per store fits a client-side SQLite
database (~≤1 GB device-dependent); one eventlog serves 10s–low 100s of
concurrent writers; apps scale horizontally across many stores.

## Comparison Stance

| Category | Representatives | Differentiator |
| --- | --- | --- |
| State-management libraries | Redux, Zustand, MobX | LiveStore adds persistence, offline, and sync to the event-based model; SQLite state is dynamically queryable vs static views |
| Backend-as-a-service | Firebase, Supabase | Server is their source of truth; LiveStore reads never leave the client |
| Local-first sync for existing DBs | ElectricSQL, Zero, PowerSync | They sync an existing Postgres; LiveStore assumes greenfield event sourcing |

External landscape reference: localfirst.fm/landscape.

## Evaluation Exercise (LS.PROD-R06)

Adopters model their app before adopting:

1. List domain events (e.g. `AppointmentScheduled`, `AppointmentCancelled`).
2. Derive the state tables those events materialize into.
3. If the model feels natural in minutes, LiveStore is likely a fit; if the
   domain resists event modeling, it likely is not.

## Derived Surfaces (LS.PROD-R07)

| Docs page | Derives from |
| --- | --- |
| `overview/why-livestore` | Positioning statement, comparison stance |
| `overview/when-livestore` | Fit matrix, evaluation exercise, envelope |
| `overview/technology-comparison` | Comparison stance |
| `misc/state-of-the-project` | Maturity & stability promise (below) |

## Maturity & Stability Promise (LS.PROD-R08)

LiveStore is in beta: most APIs are fairly stable, and work focuses on
reliability and performance toward an untimed 1.0. The stability stance
adopters can rely on:

- Minor releases may carry breaking changes of three kinds — API, client
  storage format (a `liveStoreStorageFormatVersion` bump), and sync backend
  storage format. Patch releases do not break.
- Migration guidance accompanies breaking changes where feasible; the
  release mechanics and change classification live in
  [../03-delivery/02-release/](../03-delivery/02-release/spec.md).

Maturity messaging (`misc/state-of-the-project`, a derived page) is
maintained by the BDFL (see `05-contributing/`), updated at notable
milestones; there is no formal trigger contract (current practice captured
2026-07-15). No formal browser/platform support matrix exists
(LS.PROD-DQ1).
