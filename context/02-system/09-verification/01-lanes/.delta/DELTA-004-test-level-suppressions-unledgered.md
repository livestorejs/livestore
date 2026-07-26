# DELTA-004 — Test-level suppressions bypass the quarantine ledger

Status: open

## Divergence

LS.SYS.VER.LANE-R04 requires that tolerating a known failure carry a reason, a
tracking issue, and an expiry date. The quarantine ledger delivers that for a
whole *target* — a package path, provider key, or suite. It has no equivalent for
a single test.

`it.skip`, `describe.skip`, `test.todo`, `.only`, and `exclude` globs therefore
remain a permanent, expiry-free way to keep a required check green. None is a
type error, none appears in the ledger, and nothing reds a lane when one is
forgotten. The unit lane alone carries roughly fifteen such suppressions,
including nine in `tests/package-common/src/client-session/`.

One is load-bearing for a public API: the only test covering
`makeDurableObject`'s `http.responseHeaders` option is skipped, so that option has
no executing test in any lane.

## VRS

[spec.md](../spec.md) §Test Policy.

## Close condition

Give test-level suppressions the same declared, expiring treatment as targets —
either by extending the ledger to name individual tests, or by asserting an
expected executed-test count per lane so an emptied suite reds its own cell.
Close when a forgotten `it.skip` fails a required check the way a lapsed ledger
entry does.
