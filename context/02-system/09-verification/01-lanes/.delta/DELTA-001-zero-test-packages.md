# DELTA-001 — Zero-test packages without exemptions

Status: open

## Divergence

LS.SYS.VER.LANE-R02 requires colocated unit tests or a documented exemption
per published package. Five packages have zero colocated tests and no
exemption: `adapter-web`, `adapter-cloudflare`, `sync-cf`,
`framework-toolkit`, `wa-sqlite`. Their coverage rests entirely on the
integration and conformance lanes.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.LANE-R02 (adopted
2026-07-16, interview).

## Implementation Contract

For each of the five: add colocated unit tests for the package's pure
seams, or record an explicit exemption (with rationale) in the lanes spec's
coverage table. Close when no published package is silently untested.
