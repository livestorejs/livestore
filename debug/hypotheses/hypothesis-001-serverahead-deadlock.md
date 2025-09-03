Hypothesis H001: ServerAheadError push/pull deadlock

Statement
- The leader thread’s background pushing fiber returns `Effect.never` on parent/head mismatch and expects pulling to interrupt/restart it. If pulling only advances (no rebase), pushing may never resume, causing a hang in CI.

Why likely
- CI or CI-like local runs can show repeated parent/head mismatch with static `minimumExpectedNum` and slowly increasing `providedNum`, suggesting a mismatch loop.
- Pushing path explicitly returns `Effect.never` on error and relies on restart; pulling may not always trigger it on advance.

Signals to collect
- Frequency and pattern of parent/head mismatch in DO logs.
- Whether pulling reports rebase vs advance around the time of error.
- Whether pushing restarts after advance events.

Reproduction
- Local CI-like run:
  CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 mono test integration node-sync
- Stress case:
  CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 NODE_SYNC_TODO_A=300 NODE_SYNC_TODO_B=300 NODE_SYNC_COMMIT_BATCH_SIZE=10 NODE_SYNC_LEADER_PUSH_BATCH_SIZE=100 mono test integration node-sync

Acceptance criteria (to confirm/falsify)
- Confirmed if CI logs show pushing stuck while pulling advances without rebase.
- Falsified if pushing reliably restarts after advance or if hangs occur with zero mismatch logs.

Minimal fix (gated experiment)
- Provide a way to resume pushing on `advance` (not only on `rebase`). Keep behind an env flag for A/B validation.

Cleanup plan
- Remove experimental flag and verbose logs after root cause is fixed.

