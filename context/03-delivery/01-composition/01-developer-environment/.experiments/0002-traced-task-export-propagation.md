# 0002 — Traced task-export propagation and warm status probes

Date: 2026-07-29

## Question

Why do warm shell entries still repeat the expensive pnpm and Genie status
paths after the shared setup fingerprint reports a hit, and can the floor be
reduced without weakening stale-state detection?

## Revisions

- LiveStore baseline: `6fff977115465f096e4e04f4b80da622ea693a5f`
- Effect-utils baseline:
  `99c8c7764359de121e59577e4270c1c290d6e236`
- Effect-utils implementation:
  `fc7121f40f5be934e217bc8e5fab44edb808e5c4`
  ([effect-utils#1030](https://github.com/overengineeringstudio/effect-utils/pull/1030))

## Method

- Used an isolated LiveStore worktree on one Linux host.
- Warmed the dependency, generator, Nix evaluation, and setup-fingerprint
  caches before measuring.
- Captured `setup:strict` through the shared `otel:profile:setup` task. Otelite
  normalized native devenv OTLP/gRPC spans and Effect-utils OTLP/HTTP task spans
  into one trace.
- Inspected devenv's task database and generated task wrapper to determine
  which `setup:gate` exports reached the downstream tasks.
- Invoked the exact generated pnpm and Genie status programs for negative
  checks, then restored each changed path and required a hit.
- Recorded host load with the timing samples. Samples taken while the shared
  host was oversubscribed are structural trace evidence only, not a speedup
  claim.

## Root cause

`setup:gate` declared devenv task exports, but `trace.exec` ran the task body
under `otel-span -> bash -c`. The body exported the fingerprint and cache
verdict in that child process. Devenv's generated export epilogue ran later in
the parent wrapper, where those variables did not exist. Only an already
inherited `TRACEPARENT` appeared in the task output.

The consequence was a false cold status path on every warm run:

- Genie recomputed its source and generated-file content hash.
- pnpm recomputed workspace state in addition to the required projection
  integrity digest.

The shared Effect-utils fix adds `trace.execWithExports`, which writes the
declared values to `DEVENV_TASK_EXPORTS_FILE` from inside the traced child.
`setup:gate` composes that helper and preserves an existing trace context.
LiveStore only consumes the shared fix by pinning Effect-utils.

## Structural trace evidence

The baseline connected trace
`df66e0bfb88bbfe567f35a72b448bbea` contained 24 spans, one trace, and no error
spans. Its cached status children were:

| Task | Baseline status span |
| --- | ---: |
| `genie:run` | 906.855ms |
| `pnpm:install` | 559.899ms |

After the fix, the real task output included
`DEVENV_SETUP_OUTER_CACHE_HIT=1`, `DEVENV_SETUP_FINGERPRINT`,
`DEVENV_SETUP_GIT_HASH`, `TRACEPARENT`, and `OTEL_SHELL_ENTRY_NS`.

The fixed connected trace
`18c21e580a4b1a224c378a8e953239b6` again contained 24 spans in one connected
tree and no error spans. Genie selected its bounded warm path:

| Task | Fixed status span | Interpretation |
| --- | ---: | --- |
| `genie:run` | 5.950ms | Warm verdict reached the output-existence check. |
| `pnpm:install` | 1572.926ms | Projection integrity scan retained. Timing contaminated by host load. |

The fixed capture was taken at load average `53.09 / 56.91 / 41.83` on a
32-core host with swap fully consumed. It is not comparable to the baseline
timing capture. The span shape and selected code path are still valid.

## Integrity negatives

| Mutation | Expected | Observed |
| --- | --- | --- |
| Move `node_modules/typescript` projection away | pnpm warm status misses | exit 1 |
| Move generated `.github/workflows/auto-review.yml` away | Genie warm status misses | exit 1 |
| Add an uncommitted `pnpm-lock.yaml` change | outer fingerprint misses | `DEVENV_SETUP_OUTER_CACHE_HIT=0` |
| Restore each path | both task statuses hit | exit 0 |

The Effect-utils module suite also exercises foreign and broken nested
dependency edges, missing projection metadata, and disappearing projected
symlinks on the outer-cache path.

## Benchmark

Seven same-worktree pairs invoked the exact generated status programs with the
pre-fix verdict (`DEVENV_SETUP_OUTER_CACHE_HIT=0`) and the fixed verdict
(`DEVENV_SETUP_OUTER_CACHE_HIT=1`). Pair order alternated to reduce monotonic
host-drift bias:

| Pair | Genie before | Genie after | pnpm before | pnpm after |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1088ms | 26ms | 5113ms | 1294ms |
| 2 | 682ms | 15ms | 658ms | 746ms |
| 3 | 759ms | 8ms | 1274ms | 508ms |
| 4 | 297ms | 5ms | 520ms | 408ms |
| 5 | 255ms | 4ms | 509ms | 516ms |
| 6 | 424ms | 4ms | 528ms | 454ms |
| 7 | 389ms | 6ms | 739ms | 444ms |
| Median | 424ms | 6ms | 658ms | 508ms |

The observed medians are 98.6% lower for Genie and 22.8% lower for pnpm.
However, the host load average was `64.24 / 43.60 / 39.44` at the start and
`61.62 / 44.12 / 39.68` at the end on 32 cores. The paired, alternating design
supports the direction and mechanism of the result, while the absolute values
and percentages remain low-confidence under the active oversubscription
incident. They must not become CI thresholds.

## Conclusion

The warm Genie floor was not inherent filesystem work. It was a task-export
propagation bug introduced at the tracing process boundary. Persisting exports
inside that boundary restores the intended shared composition and removes the
full Genie hash without duplicating LiveStore task wrappers.

pnpm's remaining floor is principled integrity work over the realized
dependency projection. Reducing it further requires a reusable integrity
primitive with equivalent negative-case coverage, not a LiveStore-only cache
bypass.
