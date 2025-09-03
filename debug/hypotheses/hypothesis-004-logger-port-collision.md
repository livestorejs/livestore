Hypothesis H004: Logger RPC port collisions across workers/tests

Statement
- File logger RPC server uses random ports (50k–60k). In CI parallelization, collisions/ephemeral port reuse cause logs to fail and mask underlying state.

Signals to collect
- Logger server startup messages include `LOGGER_SERVER_PORT` and path used.
- Errors connecting to `http://localhost:<port>/rpc` in worker logs.

Acceptance criteria
- Confirmed if repeated port bind errors or connectivity failures occur during hangs.
- Falsified if logs stream reliably while hang reproduces.

Remediation
- Track in-use ports and retry allocation; optionally serialize tests that share log sinks.

