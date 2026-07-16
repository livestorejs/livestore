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

Requirement IDs (`LS.SYS.RT.MESH-*`) are pending the requirements-alignment
round; until then LS.SYS.RT-R08 is the normative anchor and
[spec.md](./spec.md) captures current behavior.
