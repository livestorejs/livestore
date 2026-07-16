# 0001 — Protocol-first devtools (tools as peers, not insiders)

Status: accepted (founding decision; recorded 2026-07-16 from code and
delivery contracts).

## Context

The devtools UI ships as a separately delivered artifact on its own
cadence (see `03-delivery/03-artifacts/` and its decision 0002), attaches
to running apps across process boundaries (tabs, workers, Expo), and must
tolerate version skew between UI and engine.

## Options

- **(a) A versioned message protocol over webmesh channels — chosen.**
  All inspection and control flows through schema-defined tagged messages
  (`LSD.*`), guarded by an explicit devtools protocol version handshake
  with a compatibility test; the UI holds no privileged access to engine
  internals.
- **(b) Privileged in-process access (direct imports into the engine).**
  Rejected by the shipped architecture: it would couple the separately
  released UI artifact to engine internals and break under version skew;
  no written comparison survives beyond the versioning/compat machinery
  itself (undocumented rationale noted).

## Evidence

Implementation evidence: message schemas + protocol version + compat test
(`common/src/devtools/`), the three-transport surface, and the envelope
rules ([spec.md](../spec.md), [protocol-catalog.md](../protocol-catalog.md)).
Delivery evidence: the artifact handoff contract
(`03-delivery/03-artifacts/`).

## Consequences

- The protocol is the entire compatibility surface (LS.SYS.DT-R01/R02);
  evolving it is a contract change (LS.SYS.DT-DQ1).
- Devtools read a parallel introspection surface rather than engine
  telemetry; convergence with observability stays an open direction.
- The roadmap UI component kit can build on the same protocol without new
  privileges.
