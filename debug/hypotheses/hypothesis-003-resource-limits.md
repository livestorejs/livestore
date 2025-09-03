Hypothesis H003: Resource limits (ulimit/memory/CPU) trigger hidden timeouts

Statement
- CI’s open file limits, CPU quotas, or memory pressure cause intermittent networking or I/O failures that surface as sync stalls.

Signals to collect
- `ulimit -n`, `free -h`, `nproc` (already emitted in CI job).
- Correlation between low limits and failure runs.

Acceptance criteria
- Confirmed if raising limits/staggering load eliminates failures with no code changes.
- Falsified if failures persist under ample resources.

Remediation
- Raise limits in CI job, serialize heavy tests, or reduce concurrency locally to match CI constraints.

