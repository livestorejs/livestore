# Webmesh — Spec

This document specifies the webmesh transport substrate
(`packages/@livestore/webmesh`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: mesh nodes, edges, the three channel kinds and their reliability
semantics, packet routing, and devtools node naming. Does not define: what
is sent over the channels (leader proxy: [../spec.md](../spec.md); devtools
protocol: [../../07-devtools/spec.md](../../07-devtools/spec.md)).

## Model

A mesh node (`makeMeshNode(nodeName)`, `node.ts`) is a named participant
holding edges to other nodes. All packets share `id` (nanoid), `target`,
`source`, `channelName`, and `hops` (`mesh-schema.ts`). Nodes deduplicate
packets via a `TimeoutSet` of handled packet ids (forgotten after 1 min), so
edges may deliver duplicates without effect (LS.SYS.RT.MESH-R03) —
consumers above still see at-least-once delivery per channel kind below.

## Channel Kinds

The delivery contracts below are stable per kind (LS.SYS.RT.MESH-R01):

| Kind | Negotiation | Delivery | Transferables |
| --- | --- | --- | --- |
| Direct | request flooded, `MessagePort` returned via reverse route | raw port, no per-message ack | yes |
| Proxy | request/response handshake → `combinedChannelId` | every payload individually acked | no |
| Broadcast | none (`target: '-'`) | fire-and-forget, no ack, no buffering for late joiners | no |

- **Direct** — a `DirectChannelRequest` floods across existing edges; the
  target answers with a `DirectChannelResponseSuccess` carrying the actual
  `MessagePort`, which travels back along the exact reverse route
  (`remainingHops`). Afterwards the two nodes talk over the raw port; the
  mesh is out of the loop. Used session ⇄ leader where the platform allows.
- **Proxy** — hop-routed `ProxyChannelPayload` packets; each payload is
  individually acked (`ProxyChannelPayloadAck`). The receiver forks the ack
  send (fire-and-forget) so a slow ack cannot block delivery to the listen
  queue; the sender awaits the ack per packet id with timeout (100ms) and
  exponential retry. Reliable, but payloads are copied hop-by-hop and cannot
  carry transferables.
- **Broadcast** — fan-out to all edges with `hops`-based loop prevention;
  no acks, late joiners do not receive earlier messages (used for devtools
  session info).

Both ends must call `makeChannel` with the same `channelName` for a channel
to open; `listenForChannel` is a single-listener stream of incoming channel
requests.

## Edges and Routing

Edges exist over message ports, workers, and websockets
(`websocket-edge.ts`); websocket edges declare
`supportsTransferables: false` and msgpack-frame their payloads. On a new
edge the node broadcasts `NetworkEdgeAdded` for auto-reconnect.

Routing per packet (`sendPacket`): (1) a direct edge to `packet.target`
wins; (2) else a set `remainingHops` reverse route is followed; (3) else
the packet floods to all edges except its source, appending the node to
`hops`.

When a `DirectChannelRequest` reaches a node whose only forward edges
cannot carry transferables (e.g. a websocket edge on the path),
`checkTransferableEdges` short-circuits with a
`DirectChannelResponseNoTransferables` on the target's behalf, letting the
requester fall back to a proxy channel (LS.SYS.RT.MESH-R02).

## Devtools Node Naming

Devtools naming follows `Devtools.makeNodeName.*`
(`common/src/devtools/mod.ts`): `client-session-<storeId>-<clientId>-
<sessionId>`, `client-leader-<storeId>-<clientId>`, and random
`devtools-instance-<nanoid>` names for tools.
