# Webmesh — Requirements

Role: owns the cross-context transport substrate (`@livestore/webmesh`) —
named mesh nodes, edges over platform channel primitives, and the three
channel kinds with their distinct reliability semantics. Realizes
LS.SYS.RT-R08 (transport-agnostic messaging); non-LiveStore consumers are
in scope for the package but not for this contract.

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS.RT-*`).
Consumed by the web adapter ([../01-web/](../01-web/requirements.md)) for
session ⇄ leader ⇄ devtools wiring; the Cloudflare adapter does not use
webmesh (in-process proxy, devtools disabled).

## Requirements

- **LS.SYS.RT.MESH-R01 Channel-kind reliability semantics:** The three
  channel kinds keep distinct, stable delivery contracts — direct:
  negotiated `MessagePort`, no per-message acks; proxy: hop-routed with
  per-payload ack and retry; broadcast: fan-out without acks or buffering
  for late joiners (see [spec.md](./spec.md) §Channel Kinds). Adopted
  2026-07-16 (interview). `refines: LS.SYS.RT-R08`
- **LS.SYS.RT.MESH-R02 Transferable-path fallback:** A direct-channel
  request that cannot traverse a transferable-capable path fails fast with a
  no-transferables response so the requester falls back to a proxy channel
  (see spec §Edges and Routing). Adopted 2026-07-16 (interview).
- **LS.SYS.RT.MESH-R03 Packet dedup:** Nodes deduplicate packet ids within
  the timeout window so at-least-once edge delivery never double-applies a
  packet (see spec §Model). Adopted 2026-07-16 (interview).
