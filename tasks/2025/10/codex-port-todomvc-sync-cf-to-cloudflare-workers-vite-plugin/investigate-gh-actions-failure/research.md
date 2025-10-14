# Research: GitHub Actions Deployment Failure

## Summary

The GitHub Actions CI is failing during Cloudflare example deployment with an esbuild EPIPE error. After investigation, the root cause is:

1. **Double Build Issue**: Examples are built twice - once in the "Build examples" step without `CLOUDFLARE_ENV`, and again during "Deploy examples" with `CLOUDFLARE_ENV=preview`
2. **Resource Exhaustion**: The second build hits an esbuild service crash during CSS post-processing, likely due to resource pressure from the first build
3. **Missing --name Parameter**: The deployment was also missing the `--name` parameter for wrangler, causing Cloudflare API lookup errors (now fixed)

## Timeline of Investigation

### 1. Initial Error Analysis
- **Error**: `[vite:css-post] The service was stopped: write EPIPE`
- **Location**: During the second build in `mono examples deploy`
- **Stage**: After transforming 1122 modules, during CSS optimization

### 2. Local Testing
- Built `web-todomvc` locally with `CLOUDFLARE_ENV=preview`
- **Result**: Build succeeds in 6-7 seconds with no errors
- **Conclusion**: Issue is specific to CI environment or related to workflow structure

### 3. CI Workflow Analysis
- Discovered the workflow builds examples TWICE:
  ```yaml
  - name: Build examples
    run: pnpm --filter 'livestore-example-*' --workspace-concurrency=1 build
  - name: Deploy examples to Cloudflare
    run: mono examples deploy  # This runs pnpm build AGAIN
  ```

### 4. Fix Attempt #1: Remove Redundant Build
- **Change**: Removed the separate "Build examples" step
- **Result**: User reverted this change (commit 9e558013)
- **Reason**: Unknown - possibly wanted to keep build separate from deployment

### 5. Fix Attempt #2: Add --name Parameter
- **Issue Found**: Previous reverts removed the `--name` parameter from wrangler deploy
- **Error**: `Could not route to /accounts/***/workers/services/example-web-todomvc`
- **Root Cause**: Wrangler was looking for base worker name instead of preview name (`example-web-todomvc` vs `example-web-todomvc-preview`)
- **Fix**: Added back `--name` parameter in `cloudflare.ts:216`
- **Result**: --name parameter now passed correctly, but build still fails with EPIPE

### 6. Current State
- ✅ --name parameter is now being passed correctly
- ❌ Build still fails with esbuild EPIPE error during second build
- ❌ CI workflow still has double-build issue (user reverted the fix)

## Root Cause: Double Build Problem

### Why Building Twice Causes Issues

1. **First Build** (without CLOUDFLARE_ENV):
   - Transforms all 1122 modules
   - Generates generic build outputs
   - Consumes CI runner resources

2. **Second Build** (with CLOUDFLARE_ENV=preview):
   - Transforms all 1122 modules AGAIN
   - Generates environment-specific wrangler.json
   - Hits resource limits during CSS post-processing
   - esbuild service crashes with EPIPE

### Why It Works Locally
- Fresh environment with no prior builds
- More resources available
- Different resource management by OS

## Technical Details

### esbuild EPIPE Error
```
error during build:
[vite:css-post] The service was stopped: write EPIPE
    at afterClose (esbuild/lib/main.js:594:28)
    at onwriteError (node:internal/streams/writable:603:3)
```

**What is EPIPE?**
- "Broken Pipe" error
- Occurs when writing to a closed pipe/stream
- In this case: Vite tries to write to terminated esbuild service

**Why does esbuild terminate?**
- Resource exhaustion (memory/CPU)
- Process watchdog kills
- Concurrent build pressure
- CI runner limitations (4 CPU, 16GB RAM shared across jobs)

### Deployment Script Behavior
From `scripts/src/shared/cloudflare.ts`:

```typescript
export const buildCloudflareWorker = ({ example, kind }) => {
  const envName = resolveEnvironmentName({ example, kind })

  return cmd(['pnpm', 'build'], {
    cwd: example.repoRelativePath,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: envName,  // Sets preview/dev/prod
    },
  })
}
```

The deployment script ALWAYS builds before deploying. This is necessary because:
- Different environments need different wrangler.json configurations
- The Vite Cloudflare plugin generates environment-specific outputs based on `CLOUDFLARE_ENV`

## Proposed Solutions

### Option A: Skip Pre-Build (RECOMMENDED)
Remove the redundant "Build examples" step from CI workflow and let deployment handle all builds with correct environment variables.

**Pros:**
- Eliminates duplicate work
- Reduces CI time and resource usage
- Ensures builds always have correct CLOUDFLARE_ENV

**Cons:**
- User reverted this change (needs discussion)

### Option B: Build Caching
Cache the first build and reuse artifacts, only regenerating wrangler.json.

**Pros:**
- Keeps separate build step
- Reduces redundant work

**Cons:**
- Complex to implement
- May not solve resource exhaustion
- Vite plugin needs to support partial rebuilds

### Option C: Reduce Build Concurrency
Lower the deployment concurrency from 3 to 1.

**Pros:**
- Simple change
- Reduces resource pressure

**Cons:**
- Doesn't solve double-build waste
- Significantly increases CI time

### Option D: Increase Resource Limits
Use larger GitHub Actions runners.

**Pros:**
- May resolve resource exhaustion

**Cons:**
- Costs money
- Doesn't address inefficiency
- Not a root cause fix

## Recommendations

1. **Remove redundant build step** (Option A) - this is the cleanest solution
2. **If pre-build must stay**: Investigate why user reverted the fix and find alternative approach
3. **Short term**: Reduce concurrency to 1 as stopgap measure
4. **Long term**: Consider build caching strategy

## Additional Context

### Git History
- `fcc3ae1b`: Added --name parameter originally
- `2f64947a`: Reverted --name parameter
- `619f87c8`: My fix to remove redundant build
- `9e558013`: User reverted my fix
- `b9f0c4db`: Re-added --name parameter

### CI Environment
- Runner: Ubuntu 24.04
- Node: 24.8.0
- CPU: 4 cores (AMD EPYC 7763)
- RAM: 16GB
- esbuild: 0.25.10

### Related Files
- `.github/workflows/ci.yml:250-266` - Build and deploy job
- `scripts/src/examples/deploy-examples.ts` - Deployment orchestration
- `scripts/src/shared/cloudflare.ts:172-193` - Build function
- `scripts/src/shared/cloudflare.ts:195-241` - Deploy function
