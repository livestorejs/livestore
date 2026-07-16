# 0001 — Deterministic total-order rebase as the default conflict model

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

Concurrent offline edits must converge on every client without
coordination. The sync model needs a default answer for "what happens when
histories diverge" that keeps LS-R05 (same log → same state) trivially
true.

## Options

- **(a) Backend-arbitrated total order + rebase; materializer replay
  resolves state (last-arbitrated-write-wins at the state level) —
  chosen.** Pending events re-parent onto the arbitrated history and
  replay; determinism is structural. Documented as "deterministic conflict
  resolution: same events always produce the same state"; apps encode
  richer semantics in their event/materializer design ("flexible merge
  conflict resolution").
- **(b) CRDT-based merge semantics as the core model.** Not chosen as the
  foundation; no detailed written comparison survives (undocumented beyond
  the product positioning that event histories, not state merges, are the
  sync substrate).
- **(c) Commands / preconditions instead of blind rebase.** The evolving
  alternative, not the founding default: RFC 0002 documents where blind
  rebase produces semantically invalid states (referential-integrity,
  business-rule, and uniqueness scenarios) and proposes replayable
  commands; facts (experimental) explore event-level preconditions. Both
  are maturity-marked, owned by root LS-DQ1.

## Evidence

Documented history: `docs/overview/why-livestore.mdx` (deterministic
conflict resolution), `docs/understanding-livestore/event-sourcing.md`
(flexible conflict resolution as an app-level property). Problem evidence
for the limits: RFC 0002 §Problem. Implementation evidence: this node's
merge outcomes and invariants.

## Consequences

- Convergence and determinism come for free; semantic validity under
  concurrency is the app's job until commands/facts land (RFC 0002,
  LS-DQ1).
- Client documents adopt explicit LWW value semantics on this substrate
  (`02-state/01-sqlite/`).
