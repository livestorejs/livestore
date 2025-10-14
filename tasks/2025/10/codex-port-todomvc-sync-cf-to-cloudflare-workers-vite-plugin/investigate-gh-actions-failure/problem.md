# Problem: GitHub Actions Example Deployment Failure

## Overview

The GitHub Actions CI workflow is failing at the `build-and-deploy-examples-src` job, specifically during the build phase of the `web-todomvc` example when running `pnpm build`.

## Error Details

### Primary Error
```
[vite:css-post] The service was stopped: write EPIPE
    at afterClose (/home/runner/work/livestore/livestore/node_modules/.pnpm/esbuild@0.25.10/node_modules/esbuild/lib/main.js:594:28)
```

### Full Stack Trace
```
✗ Build failed in 19.55s
error during build:
[vite:css-post] The service was stopped: write EPIPE
    at /home/runner/work/livestore/livestore/node_modules/.pnpm/esbuild@0.25.10/node_modules/esbuild/lib/main.js:718:38
    at responseCallbacks.<computed> (/home/runner/work/livestore/livestore/node_modules/.pnpm/esbuild@0.25.10/node_modules/esbuild/lib/main.js:603:9)
    at afterClose (/home/runner/work/livestore/livestore/node_modules/.pnpm/esbuild@0.25.10/node_modules/esbuild/lib/main.js:594:28)
    at /home/runner/work/livestore/livestore/node_modules/.pnpm/esbuild@0.25.10/node_modules/esbuild/lib/main.js:1986:18
    at onwriteError (node:internal/streams/writable:603:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:92:21)
```

### Context
- **Job**: `build-and-deploy-examples-src`
- **Step**: Deploy examples to Cloudflare
- **Command**: `mono examples deploy`
- **Affected Example**: `web-todomvc` (likely others too)
- **Build Process**: Running `pnpm build` in `examples/web-todomvc`
- **Environment**: GitHub Actions (Ubuntu 24.04, Node 24.8.0)

## Build Process Flow

From `scripts/src/examples/deploy-examples.ts`:
1. Build step: `buildCloudflareWorker()` calls `pnpm build` in the example directory
2. The build sets `CLOUDFLARE_ENV` environment variable (e.g., `preview`)
3. Vite's Cloudflare plugin emits environment-specific `wrangler.json`
4. Deploy step: `deployCloudflareWorker()` runs `bunx wrangler deploy`

## Root Cause Analysis

### What is EPIPE?
EPIPE (Broken Pipe) error occurs when:
1. A process tries to write to a pipe/stream
2. The reading end of the pipe has been closed
3. In this case: esbuild's CSS post-processing plugin tries to write to a closed esbuild service

### Why is this happening?
The error `[vite:css-post] The service was stopped: write EPIPE` indicates that:
1. Vite's CSS post-processing plugin (`vite:css-post`) uses esbuild to process CSS
2. The esbuild service process terminates unexpectedly during the build
3. Vite tries to send more work to the terminated esbuild service
4. The write operation fails with EPIPE because the pipe to esbuild is closed

### Potential Causes
1. **Memory Pressure**: GitHub Actions runners have 16GB RAM, but the build transforms 1122 modules. The esbuild service might be killed by OOM or resource constraints.
2. **Concurrency Issues**: The deployment runs with `concurrency: 3` (deploying 3 examples in parallel). Combined with the pre-build step running `pnpm --filter 'livestore-example-*' --workspace-concurrency=1 build`, there might be resource contention.
3. **esbuild Version**: Using esbuild@0.25.10 - there may be a bug or compatibility issue with this version.
4. **Timeout/Watchdog**: GitHub Actions or Nix environment may have watchdog processes killing long-running build processes.
5. **Race Condition**: The build succeeded in transforming 1122 modules before failing, suggesting the error happens late in the build process (possibly during CSS optimization/minification).

## Evidence from Logs

### Build Progress Before Failure
```
✓ 1122 modules transformed.
✗ Build failed in 19.55s
```

This shows:
- The main transformation phase completed successfully
- The failure occurs in a post-processing phase (CSS optimization)
- The build took ~20 seconds before failing

### Deployment Context
```
Deploy branch: codex/port-todomvc-sync-cf-to-cloudflare-workers-vite-plugin
Deploying: cf-chat, web-linearlite, web-todomvc, web-todomvc-custom-elements,
           web-todomvc-experimental, web-todomvc-script, web-todomvc-solid,
           web-todomvc-sync-cf using livestore.workers.dev
```

Multiple examples are being deployed concurrently (concurrency: 3), which may exacerbate resource issues.

## Impact

- **CI Blocking**: The deployment job fails, preventing example apps from being deployed
- **No Merge**: Pull requests cannot be merged with failing CI
- **Cascading Failure**: This appears to happen consistently across multiple attempts (checked runs from 2025-10-13)

## Expected Behavior

- Builds should complete successfully in GitHub Actions
- Examples should deploy to Cloudflare Workers
- CI should pass

## Actual Behavior

- Build fails with EPIPE error during CSS post-processing
- Deployment never completes
- CI job fails

## Reproduction Steps

To reproduce this issue locally using act-cli:
1. Install act-cli via nix: `nix-shell -p act`
2. Pass through required environment variables:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Run the specific job: `act -j build-and-deploy-examples-src --secret CLOUDFLARE_API_TOKEN=xxx --secret CLOUDFLARE_ACCOUNT_ID=yyy`

## Next Steps

1. Reproduce the issue locally using act-cli
2. Investigate memory/resource usage during the build
3. Test potential fixes:
   - Reduce build concurrency
   - Update/pin esbuild version
   - Add resource limits/monitoring
   - Split build and deploy into separate jobs
4. Verify fix works in GitHub Actions
