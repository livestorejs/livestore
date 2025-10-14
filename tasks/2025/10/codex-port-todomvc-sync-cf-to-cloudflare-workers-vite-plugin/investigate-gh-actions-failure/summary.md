# Investigation Summary

## Status
🔍 **Root Cause Identified**: CI-specific deployment failure, NOT a code issue

## What Works ✅
1. ✅ **esbuild EPIPE errors SOLVED** - Reducing concurrency to 1 fixed build crashes
2. ✅ **Local builds succeed** - Examples build without errors
3. ✅ **Local deployment succeeds** - Wrangler deploys successfully to Cloudflare
4. ✅ **TypeScript changes effective** - CI runs code without `--name` parameter
5. ✅ **Fresh builds work** - Cleaned dist and rebuilt, still works

## What Fails ❌
❌ **Only CI deployment fails** with Cloudflare API error 7003

## Error Pattern in CI
```
[ERROR] A request to the Cloudflare API (/accounts/***/workers/services/example-cf-chat-preview) failed.
Could not route to /accounts/***/workers/services/example-cf-chat-preview [code: 7003]
No route for that URI [code: 7000]
```

## Key Insights

### 1. Code is Correct
- Same code works locally
- Same credentials work locally
- Same build artifacts work locally
- CI is running the correct, updated TypeScript code

### 2. CI-Specific Factor
Since everything works locally, the issue MUST be one of:
- **Wrangler state/cache in CI**
- **CI environment variables affecting wrangler**
- **Race conditions from workflow structure**
- **Network/timing differences in CI**
- **Permissions issue specific to CI GitHub Actions**

### 3. The Service Exists
- Local deployment created `example-cf-chat-preview` successfully
- Service is now live at `https://example-cf-chat-preview.livestore.workers.dev`
- Subsequent local deployments work (updates to existing service)

## Hypothesis: Wrangler Cache/State Issue

### Evidence
1. CI fails consistently at same point
2. Error is about looking up non-existent service
3. But local deployment created the service successfully
4. CI might have stale wrangler cache pointing to old/invalid state

### Solution Direction
Add wrangler state clearing in CI workflow BEFORE deployment:

```yaml
- name: Clear wrangler cache
  run: rm -rf ~/.config/.wrangler ~/.wrangler

- name: Deploy examples to Cloudflare
  run: mono examples deploy
```

## Alternative Hypothesis: CI Workflow Caching

### Evidence
- GitHub Actions caches various directories
- Setup-env action might restore cached wrangler state
- Cache key might not include wrangler config changes

### Solution Direction
Check `.github/actions/setup-env` for wrangler caching

## Recommended Next Steps

### Priority 1: Clear Wrangler State
Add cache clearing before deployment in CI workflow

### Priority 2: Check Setup-Env Action
Verify what's being cached in `.github/actions/setup-env/action.yml`

### Priority 3: Add Debugging
Add wrangler verbose logging to CI:
```bash
bunx wrangler deploy --config dist/example_cf_chat/wrangler.json --verbose
```

### Priority 4: Test with ACT (if needed)
Only if above don't work, use act-cli to reproduce exact CI environment

## Files to Review
1. `.github/workflows/ci.yml` - Add cache clearing
2. `.github/actions/setup-env/action.yml` - Check caching behavior
3. `scripts/src/shared/cloudflare.ts` - Consider adding retry logic

## Success Criteria
✅ CI deployment succeeds without Cloudflare API errors
✅ All examples deploy successfully in sequence
✅ No esbuild crashes (already fixed)
