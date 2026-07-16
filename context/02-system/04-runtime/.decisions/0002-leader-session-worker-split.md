# 0002 — Leader/session split with the leader off the UI thread

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

A client (e.g. a browser profile) runs multiple sessions (tabs) sharing
one local dataset. Persistence and sync must not run once per tab, must
survive tab churn, and must stay off the UI thread.

## Options

- **(a) One leader role per client owning persistence + sync; sessions
  hold in-memory mirrors and proxy to the leader — chosen.** One writer
  per client makes multi-tab consistency an election problem rather than a
  write-conflict problem; heavy work (materialization of pulled events,
  eventlog IO, backend sync) leaves the UI thread; on the web the leader
  is a dedicated worker mediated by a shared worker.
- **(b) Per-session persistence (each tab owns files/sync).** Not chosen;
  no explicit written comparison survives, but the documented topology
  ("second SQLite database for persistence running in a separate thread
  (e.g. web worker)") and the single-writer invariant (LS.SYS.RT-R01)
  encode the choice.

## Evidence

Documented history: `docs/understanding-livestore/design-decisions.md`,
`docs/overview/how-livestore-works.mdx`, `docs/overview/concepts.md`
(client/session/leader terminology). Implementation evidence: the runtime
topology ([spec.md](../spec.md) §Topology), web election/handover
(`01-web/03-leadership/`).

## Consequences

- The proxy contract, leader election, handover, and crash-detection
  machinery exist because of this split (this node and `01-web/`).
- Degenerate colocated realizations (single-tab, in-memory, Cloudflare DO)
  keep the same contract with `isLeader: true`.
- Sync processors are split session-side/leader-side
  (`03-sync/02-processors/`).
