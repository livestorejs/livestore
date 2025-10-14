# CI vs Local Environment Analysis

## Current Issue
Cloudflare Workers deployment fails in CI with error code 7003: "Could not route to /accounts/***/workers/services/example-cf-chat-preview"

## What Works Locally
- ✅ Building examples with `CLOUDFLARE_ENV=preview` succeeds
- ✅ Generates correct `wrangler.json` with `"name":"example-cf-chat-preview"`
- ✅ `bunx wrangler deploy --config dist/example_cf_chat/wrangler.json --dry-run` succeeds

## What Fails in CI
- ❌ Actual deployment to Cloudflare fails
- ❌ Wrangler tries to look up existing service before deploying
- ❌ Service doesn't exist, resulting in 7003 error

## Key Differences: CI vs Local

### 1. **Actual Deployment vs Dry Run**
- **Local**: Only tested with `--dry-run` flag
- **CI**: Actually attempts to deploy to Cloudflare
- **Impact**: Dry run skips API calls that check for existing services

### 2. **Cloudflare Account Access**
- **Local**: Same credentials (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
- **CI**: Actually connects to Cloudflare API
- **Impact**: Local testing doesn't reveal API interaction issues

### 3. **Worker Service State**
- **Potential Issue**: CI is trying to deploy to `example-cf-chat-preview`
- **Question**: Does this service already exist in Cloudflare?
- **Question**: If not, why is wrangler trying to look it up?

### 4. **Build Fixes Applied**
- ✅ Removed redundant build step from CI workflow
- ✅ Reduced deployment concurrency from 3 to 1
- ✅ Removed `--name` parameter from wrangler deploy
- ✅ esbuild EPIPE errors are SOLVED

## Wrangler Behavior Analysis

### Error Pattern
```
[ERROR] A request to the Cloudflare API (/accounts/***/workers/services/example-cf-chat-preview) failed.
Could not route to /accounts/***/workers/services/example-cf-chat-preview, perhaps your object identifier is invalid? [code: 7003]
No route for that URI [code: 7000]
```

### What This Means
1. Wrangler is making a GET request to `/workers/services/example-cf-chat-preview`
2. This endpoint doesn't exist (404/7003 error)
3. The service name is coming from `wrangler.json`: `"name":"example-cf-chat-preview"`

### Why This Happens
Wrangler appears to check if a worker service exists before deploying. For NEW workers, this check will fail. However, typical wrangler behavior is to CREATE the service if it doesn't exist.

### Hypothesis
The issue might be related to:
1. **Permissions**: API token may lack permission to create new services
2. **Wrangler Version**: Bug in wrangler 4.42.2
3. **Configuration**: Missing required fields in wrangler.json for new service creation
4. **Environment**: CI-specific environment variable affecting wrangler behavior

## Test Strategy

### Phase 1: Reproduce with Real Deploy (PRIORITY)
Test the actual deployment locally with real Cloudflare credentials:

```bash
cd examples/cf-chat
env CLOUDFLARE_ENV=preview pnpm build
bunx wrangler deploy --config dist/example_cf_chat/wrangler.json
```

**Expected Outcomes:**
- **If succeeds**: CI environment has additional constraints
- **If fails with same error**: Problem is reproducible locally
- **If fails differently**: Different root cause

### Phase 2: Check Cloudflare Dashboard
1. Log into Cloudflare dashboard
2. Check if `example-cf-chat-preview` service exists
3. Check if base `example-cf-chat` service exists
4. Verify API token permissions

### Phase 3: Test with ACT CLI
Only if Phase 1 doesn't reproduce:

```bash
# Create act secrets file
cat > .act-secrets << EOF
CLOUDFLARE_API_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=<account-id>
EOF

# Run the specific job
nix-shell -p act --run "act -j build-and-deploy-examples-src --secret-file .act-secrets"
```

## Action Items

1. ✅ **COMPLETED**: Document CI vs local differences
2. **NEXT**: Test actual deployment locally (not dry-run)
3. **THEN**: Check Cloudflare dashboard for existing services
4. **IF NEEDED**: Use act-cli to reproduce CI environment
5. **FINALLY**: Implement fix based on findings

## Related Files
- `.github/workflows/ci.yml:259` - Deploy examples step
- `scripts/src/shared/cloudflare.ts:207` - Deploy function
- `scripts/src/examples/deploy-examples.ts:192` - Concurrency setting
- `examples/cf-chat/vite.config.ts` - Cloudflare plugin configuration
