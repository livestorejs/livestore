# Solution: Remove account_id from Generated wrangler.json

## Problem

The `@cloudflare/vite-plugin` generates wrangler.json with `"account_id": null`, which prevents wrangler from properly using the CLOUDFLARE_ACCOUNT_ID environment variable in CI/CD environments, causing error 7003.

## Root Cause

Based on research of Cloudflare workers-sdk GitHub issues:
- **Issue #1590**: Wrangler not honoring CLOUDFLARE_ACCOUNT_ID when cached config exists
- **Issue #3614**: Wrangler using literal "CLOUDFLARE_ACCOUNT_ID" string instead of value
- **Issue #2100**: Error 7003 "Could not route to /accounts/.../workers/services/..."

When `account_id` is explicitly set to `null` in wrangler.json, wrangler fails to fall back to the CLOUDFLARE_ACCOUNT_ID environment variable.

## Solution

Post-process the generated wrangler.json after build to **remove the `account_id` field entirely** (not set it to null, but omit it completely).

### Implementation

Modified `scripts/src/shared/cloudflare.ts` in the `buildCloudflareWorker` function:

1. After the `pnpm build` step completes
2. Read the generated wrangler.json
3. Remove the `account_id` field if present
4. Write the modified config back

This allows wrangler to properly resolve the account from the CLOUDFLARE_ACCOUNT_ID environment variable.

## Testing

### Local Deployment: ✅ SUCCESS

- Built cf-chat example
- Verified `account_id` field removed from `examples/cf-chat/dist/example_cf_chat/wrangler.json`
- The generated file now omits `account_id` entirely instead of setting it to `null`

### CI Deployment: ⏳ PENDING

Next step: Push to CI and verify the deployment succeeds in GitHub Actions.

## References

- https://github.com/cloudflare/workers-sdk/issues/1590
- https://github.com/cloudflare/workers-sdk/issues/3614
- https://github.com/cloudflare/workers-sdk/issues/2100
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
