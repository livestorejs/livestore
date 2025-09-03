Hypothesis H002: Wrangler inspector / orphaned processes cause CI stalls

Statement
- Wrangler dev server or workerd subprocesses (or inspector port) behave differently in CI, leaving orphaned processes or blocked readiness that stalls the test.

Signals to collect
- Process snapshots before/after tests (`ps -eo pid,ppid,cmd | egrep "wrangler|workerd|vitest|bunx"`).
- Wrangler stdout readiness lines and any EPIPE issues.

Acceptance criteria
- Confirmed if wrangler readiness fails or zombie processes persist after tests correlating with the hang.
- Falsified if wrangler readiness is timely and processes are cleaned up while hang still occurs.

Remediation
- Increase startup timeout; ensure stdout drain coverage; add post-test cleanup.

