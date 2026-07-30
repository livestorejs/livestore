# 0002 — Decouple LiveStore release cadence from DevTools artifacts

Status: superseded by 0003-devtools-in-contrib

Decided: 2026-07-15; extracted from the delivery spec during review — the
decision predates this record.

Superseded: 2026-07-30 by [0003-devtools-in-contrib](0003-devtools-in-contrib.md).
The Context below opens "LiveStore releases consume a prebuilt DevTools artifact
produced from `overeng` source". That premise no longer holds: the DevTools
source moved into `livestore-contrib` and the artifact producer is retired, so
there is no artifact to certify and no cadence to decouple. The reasoning is
preserved rather than rewritten — the decision was correct for the world it
described.

## Context

LiveStore releases consume a prebuilt DevTools artifact produced from
`overeng` source (see the DevTools Artifact Release section of
[../spec.md](../spec.md)). LiveStore releases happen considerably more often
than DevTools releases.

## Options

1. **Certify per LiveStore version, durably** — store LiveStore-version-
   specific certification in the manifest. Every LiveStore release becomes a
   DevTools release step; manual certification text rots.
2. **Immutable artifact identity + release-time certification (chosen)** —
   the checked-in manifest carries only immutable artifact identity
   (URLs + checksums); compatibility is proven ephemerally by release CI for
   the exact release candidate.

## Decision

Option 2. Durable state is limited to immutable artifact identity; the
compatibility gate runs during LiveStore release validation; publish depends
on the CI proof for the same release candidate; `overeng` is required only to
produce or replace artifacts.

## Rationale

- The cadence invariant — LiveStore releases must not require `overeng` work
  while the pinned artifact is still compatible — holds because normal
  releases only re-verify the pinned artifact.
- The original safety property (never ship an unverified pairing) is
  preserved by gating publish on release-candidate CI proof instead of
  durable certification text, without making every LiveStore release a
  DevTools release.

## Evidence

Operational experience with the two-repo artifact handoff; the release
scenarios table in [../spec.md](../spec.md) enumerates the cases and shows
only artifact-affecting changes require `overeng`.
