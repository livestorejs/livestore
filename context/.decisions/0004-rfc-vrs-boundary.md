# 0004 — RFC ↔ VRS boundary: proposals stay in the RFC until accepted

Status: accepted (2026-07-16, design interview with schickling; resolves the
placement half of LS-DQ1)

## Context

The VRS tree is the always-current intent layer (LS-R15, decision 0002); it
describes the system that exists. RFCs (`contributor-docs/rfcs/`) are the
proposal pipeline. Before this decision, an unaccepted RFC could leak into the
tree three ways: a `Maturity: proposal` spec section (e.g. event-model's
`## Command Replay`), a `(proposal)`-tagged ontology term (`Command`), and a
stale proposal doc living outside both the RFC and the tree
(`wip/upcoming-specs/store-commit-receipt.md`). Each blurs the line between
shipping reality and speculation, and each duplicates design that the RFC
already owns — inviting drift.

## Options

- **A. Marked-inline (prior state).** Proposal sections and terms live in the
  owning nodes, clearly `Maturity: proposal`-marked. Rich locality, but
  proposal prose interleaves with shipping prose and duplicates the RFC.
- **B. Proposals stay in the RFC; the tree carries only pressure + a pointer
  (chosen).** An unaccepted RFC's design and coined terms live only in the RFC.
  The tree's entire footprint is (1) the real limitation the RFC addresses,
  stated on the affected node where that limitation is true of the shipping
  system, and (2) a pointer to the RFC from a single open question (root
  `LS-DQ1` is the anchor; node `DQ`s cross-reference it). `Maturity: proposal`
  stops being a legal spec marker; `Maturity: experimental` stays because
  experimental features have real code and describe real (unstable) behavior.
- **C. Quarantine.** Zero tree footprint until acceptance. Rejected: loses the
  ability to record, on the affected node, a real limitation that motivates the
  proposal — that limitation is true today and belongs in the tree.

## Decision

Option B. Evidence: user decision in the 2026-07-16 interview ("command doesn't
exist yet and should only exist in the rfc, not yet full VRS"; "Adopt as
stated").

## Consequences

- `spec.md` Maturity Markers drops `proposal`; the enforcement suite's maturity
  vocabulary accepts only `experimental`.
- `spec.md` Precedence gains the pre-acceptance footprint rule (design + terms
  in the RFC; tree carries limitation + pointer).
- Cleanup for RFC 0002: the `Command` term leaves `ontology.md`; the
  `## Command Replay` section leaves `01-event-model/spec.md`; the stale
  `wip/upcoming-specs/store-commit-receipt.md` is deleted and `wip/` dissolves;
  `LS.SYS.STORE-DQ1` drops the wip reference; root `LS-DQ1` is reframed from
  placement (resolved here) to acceptance and points at RFC 0002.
- On acceptance, an RFC's durable content folds into the owning nodes, its
  coined terms enter `ontology.md`, and the RFC becomes a historical record
  (unchanged from decision 0002).
