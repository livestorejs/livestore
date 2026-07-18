# Web Runtime — Spec

This document specifies the browser adapter
(`packages/@livestore/adapter-web`) at the realization-contract level. It
builds on [requirements.md](./requirements.md); the mechanism-agnostic
contract is in [../spec.md](../spec.md). The mechanics live in the child
nodes:

| Child | Owns |
| --- | --- |
| [01-persistence/](./01-persistence/spec.md) | OPFS databases, storage probes + fallback, state-db naming, fast path, identity keys |
| [02-topology/](./02-topology/spec.md) | worker graph, two-layer init messages, port swap + mediation, boot-status proxying |
| [03-leadership/](./03-leadership/spec.md) | the two locks, election + handover, death detection, shutdown propagation |

## Status

Draft.

## Variants

Each variant is a configuration of the three child mechanics
(LS.SYS.RT.WEB-R04); all return the same `ClientSession` contract:

| Variant | Entry | Persistence | Topology | Leadership |
| --- | --- | --- | --- | --- |
| Worker (default) | `web-worker/` | OPFS | full (shared + leader worker) | two-lock election |
| Single-tab | `single-tab/` | OPFS | no mediation layer; dedicated leader worker retained, session speaks both port layers itself; devtools disabled | static `has-lock` |
| In-memory | `in-memory/` | none | no workers; leader inline in-context (optional devtools-only shared worker) | static `has-lock` |

The worker adapter falls back to single-tab automatically when
`SharedWorker` is unavailable (e.g. Android Chrome). Single-tab warns that
multiple tabs on one `storeId` can conflict.

## Devtools Wiring

The adapter exports `./devtools-web-channel` (webmesh `direct` mode) and
hosts the browser-extension `postMessage` bridge (LS.SYS.RT.WEB-R05);
protocol and surfaces are owned by
[../../07-devtools/](../../07-devtools/spec.md). Webmesh node names follow
`Devtools.makeNodeName.client.{session,leader}`.
