# 0001 — Two-phase pull; no long-lived streaming between DOs

Status: accepted (2025 CF design exploration; recorded 2026-07-16).

## Context

Live pull needs both low-latency history delivery and ongoing reactivity,
but Durable Objects bill for wall-clock time while an isolate is pinned
awake, and hibernatable WebSockets only save cost if the DO can actually
hibernate between events. A transport that holds a stream open across both
the sync DO and a client DO keeps both alive for the entire pull. The core
tension: streaming that is reactive *and* allows hibernation.

## Options

- **(a) Two-phase pull — chosen.** Phase 1: an initial pull streams all
  stored events and closes once history is drained (low latency, bounded
  lifetime). Phase 2: a separate liveness path delivers newly pushed events
  per transport (WS: server-emitted chunks to hibernatable sockets; DO-RPC:
  callback into the client DO; HTTP: client polling). Isolates can
  hibernate between phase-2 events.
- **(b) HTTP streaming (`enable_request_signal`).** Rejected: worked, but
  kept both client and server DOs alive for the whole duration of the pull
  (CPU billing). The compatibility flag remains only for the bounded
  phase-1 stream.
- **(c) DO-RPC `ReadableStream` transport.** Rejected: worked, same
  problem — both DOs pinned awake for the stream's lifetime.

## Evidence

Design exploration notes (2025 CF work, formerly `wip/2025-cf.md`):
both rejected paths were built and observed to pin both DOs.
Implementation evidence: the current transports realize (a) —
`makeEndingPullStream` closes after draining history (`cf-worker/do/pull.ts`)
with per-transport liveness on top (see [spec.md](../spec.md) §Transports).

## Consequences

- Liveness semantics necessarily differ per transport (LS.SYS.SYNC.CF-R05);
  there is no single long-lived stream abstraction.
- Hibernated-client delivery gaps become possible on DO-RPC (issue #1415) —
  the price of not pinning the client DO awake.
- Hibernatable *outgoing* WS support (workerd#4864) could later simplify
  phase 2 (see root roadmap, Cloudflare runtime directions).
