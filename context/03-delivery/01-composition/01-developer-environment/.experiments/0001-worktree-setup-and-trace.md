# 0001 — Worktree setup benchmark and connected-trace proof

Date: 2026-07-27

## Question

Does removing the full TypeScript build from automatic setup materially reduce
cold and warm shell entry while preserving dependency integrity, explicit
TypeScript validation, and a connected setup trace?

## Method

- Compared current-main baseline `c28a6e4ec` with the implementation patch on
  the same Linux host.
- Created a fresh detached disposable worktree for each cold measurement.
- Ran `devenv shell -- true` twice: first for the cold path, then for the warm
  path.
- Kept the shared Effect-utils pnpm materialization path unchanged.
- Ran `ts:build` explicitly after removing it from automatic setup.
- Captured `setup:strict` with native devenv OTLP/gRPC tracing and Effect-utils
  OTLP/HTTP task spans through one otelite instance.
- Inspected normalized otelite spans and asserted the native
  `setup:gate` → Effect-utils `devenv.task.exec` parent relationship.

The historical macOS result in issue #1402 is retained as incident context, not
as a cross-host comparison.

## Results

| Path | Current baseline | Implementation | Change |
| --- | ---: | ---: | ---: |
| Cold `devenv shell -- true` | 30.07s | 23.402s | -22.2% |
| Warm `devenv shell -- true` | 4.89s | 1.773s | -63.7% |

Final cold-path observations:

- devenv/Nix evaluation: 14.1s
- setup task graph: 8.43s
- `pnpm:install`: 7.35s
- `genie:run`: 5.76s, parallel with pnpm
- automatic `ts:build`: absent

Explicit `ts:build` remained green and took 2.77s warm.

The representative strict-setup capture contained:

- 24 spans
- 5 metrics
- 0 rejected spans
- 0 error spans
- 1 trace ID across native devenv and Effect-utils task spans

The slow cached task children were the status probes:

- `pnpm:install`: 2.71s
- `genie:run`: 1.97s

## Conclusion

Dependency and generated-source readiness are sufficient for shell entry.
Moving full TypeScript validation to explicit gates reduces both cold and warm
latency without bypassing pnpm or Genie integrity checks.

Native devenv tracing plus Effect-utils task spans provides a connected,
queryable hierarchy when the transports are deliberately split: native spans
export to otelite's gRPC receiver and Effect-utils shell spans export to its
HTTP receiver. Otelite makes the proof deterministic without a persistent
collector or timing sleeps.

The next measured targets are cold Nix/devenv evaluation, pnpm projection, and
warm dependency status probes.
