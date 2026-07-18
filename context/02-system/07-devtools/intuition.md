# Devtools — Intuition

*For: contributors touching devtools messages or surfaces · Assumes:
[../intuition.md](../intuition.md) · Covers: why devtools speak a versioned
protocol instead of reaching into the engine*

## Tools are peers, not insiders

Devtools get no privileged access to engine internals. A devtools surface is
just another node on the webmesh that speaks schema-defined, versioned
messages to two endpoints: the client session (queries, reactivity) and the
leader (eventlog, sync state, reset, network latches).

```
devtools surface ──webmesh──▶ ClientSession namespace (inspect session)
                └───────────▶ Leader namespace        (inspect/control client)
```

The protocol-first rule is what makes everything else possible: surfaces can
ship on their own release cadence (the devtools UI is a separate artifact —
[../../03-delivery/](../../03-delivery/spec.md)), run in different processes
or origins, be community-built (Expo devtools in contrib), and eventually be
opened up as a component kit (root `roadmap.md`) — all without any of them
being able to corrupt an engine invariant. The message schema is the entire
attack/compat surface.

## Discovery, then compatibility, then control

Sessions announce themselves (store/client/session identity, schema alias,
leader flag) on a broadcast channel — tools enumerate running clients
without app cooperation. Every handshake carries an integer devtools
protocol version; an unsupported version gets an explicit version-mismatch
reply instead of a half-working session (unversioned legacy peers count as
protocol 1; the LiveStore package version in messages is display-only).
Control operations — reset or import the database, inject an event, latch
pull/push to simulate offline — are explicit protocol messages, never
behavior a tool triggers implicitly.

## What "inspectable" promises

Whatever the engine knows about itself — the eventlog, derived state, sync
and network status — must be reachable over this protocol (root LS-R13).
Passive telemetry is the other half of transparency and lives in
[../06-observability/](../06-observability/intuition.md).
