# CF Adapter Benchmark

Standalone deployable Cloudflare Worker for benchmarking the livestore DO adapter's `rows_written` and cold start performance on real CF infrastructure.

> **WARNING: This deploys to a real Cloudflare account and consumes real resources.**
> Each full bench run (~10k todos) uses ~42k `rows_written`. The free tier allows 100k/day.
> On paid accounts, usage beyond the free tier is billed. Plan bench runs accordingly.

## What it measures

- **Boot cost** — `rows_written` and latency for the first event on a fresh store
- **Steady-state writes** — `rows_written` per todo at increasing tiers (10 → 100 → 1k → 5k → 10k+). The key metric is `writes/todo` = `rows_written / todos added in tier`. Ideal is 1.0 (one event = one row); the VFS baseline is ~238.
- **Cold start** — `rows_written` and latency when a DO wakes up and restores from snapshot
- **Post-restart steady-state** — confirms write rate is unchanged after a cold start

## Usage

```bash
pnpm install
pnpm deploy                 # deploy to your CF account (requires `wrangler login`)
./run-bench.sh <url>        # run benchmark against deployed worker
```

For local testing (no CF billing):

```bash
pnpm dev                    # start local wrangler dev server
./run-bench.sh http://localhost:8787
```

## How it works

A `BenchStoreDo` Durable Object wraps `storage.sql` with a Proxy that tracks `cursor.rowsWritten` after every `exec()` call. The bench script sends HTTP requests to create todos in bulk, then reads the accumulated `rowsWritten` from the `/store/metrics` endpoint.

This project has its own `pnpm-workspace.yaml` and uses `workspace:*` dependencies to build against local adapter changes. It does not affect the monorepo's root lockfile.
