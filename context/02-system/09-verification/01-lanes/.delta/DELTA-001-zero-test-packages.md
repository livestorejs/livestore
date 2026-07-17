# DELTA-001 — Zero-test packages without exemptions

Status: open

## Divergence

LS.SYS.VER.LANE-R02 requires colocated unit tests or a documented exemption
per published package. Four packages have zero colocated tests and no
exemption: `adapter-web`, `adapter-cloudflare`, `sync-cf`, `framework-toolkit`.
Their coverage rests entirely on the integration and conformance lanes.
(`wa-sqlite` is a vendored fork with its own 13 test files and a dedicated
substrate lane — `mono test wa-sqlite` → CI `wa-sqlite-test`; it is exempt, not
silently untested.)

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.LANE-R02 (adopted
2026-07-16, interview).

## Implementation Contract

For each of the four: add colocated unit tests for the package's pure
seams, or record an explicit exemption (with rationale) in the lanes spec's
coverage table. Close when no published package is silently untested.
