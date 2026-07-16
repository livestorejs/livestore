# DELTA-002 — Lane table and CI decomposition mismatch

Status: open

## Divergence

LS.SYS.VER.LANE-R03 requires each lane to map to exactly one command with
the table in sync with CI. Today: "integration" is one local verb but three
CI job families (sync-provider matrix, playwright suites, wa-sqlite);
`tests/package-common/` has no dedicated verb (hardcoded into the unit lane
in `scripts/src/commands/test-commands.ts`); examples-as-tests
(`mono examples test`) is not a required CI gate and is absent from the
lane table's command column.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.LANE-R03 (adopted
2026-07-16, interview).

## Implementation Contract

Either give the divergent surfaces their own verbs/gates (e.g.
`mono test package-common`, an examples gate) or restructure the lane table
so each row maps 1:1 to an existing command and CI job family; then keep
them in sync (candidate: extend the intent-layer enforcement suite to
cross-check the table against `test-commands.ts` and `ci.yml`). Close when
table, commands, and CI agree.
