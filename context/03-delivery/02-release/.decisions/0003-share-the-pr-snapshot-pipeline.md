# 0003 — Share the PR snapshot pipeline with contrib

Status: accepted

Evidence: byte-identical regeneration of `ci.yml`, `release.yml` and
`labels.json` when this repository was moved onto the shared factory.

## Context

livestore-contrib needs the same label-gated PR snapshot guarantee this
repository gained in [.decisions/0002](./0002-fork-snapshot-trust-label.md).
The pipeline is the code that decides whether untrusted, fork-authored bytes may
become an immutable npm version, so two copies of it would be two answers to
that question.

## Options

| Option | Consequence |
| --- | --- |
| Contrib copies the pipeline | Immediate; the authorization rules and the validator drift independently |
| Extract to a shared factory, both repos consume it | One implementation; requires proving the extraction changes nothing here |
| Contrib goes without PR snapshots | No new surface; external contributions remain unusable without a local build |

## Decision

Extract the job graph, the candidate validator and the trust label into
`effect-utils`, and make this repository the first consumer.

The extraction was performed here first and gated on byte-identical generated
output, so the shared factory is known to reproduce a pipeline that has already
published a real cohort — rather than one that merely looks equivalent. The gate
was also shown capable of failing: perturbing a factory default moves the
generated output, and restoring it returns the output to identical.

The validator ships as a generated file in both repositories so neither can
quietly diverge on what constitutes a valid candidate. It is excluded from each
repository's formatter, because the two format at different print widths and a
single shared file cannot satisfy both — and reformatting a generated,
read-only validator would only make the repositories disagree about its bytes.

## Consequences

A change to the pipeline is now a change to a shared dependency, arriving here
as a lock bump rather than an edit. That is the intended trade: it costs a repin
to change, and in exchange the two repositories cannot answer the publication
question differently.
