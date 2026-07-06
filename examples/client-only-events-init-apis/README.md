# Client-only event initialization APIs

Visual comparison app for explicit LiveStore client-only event initialization patterns.

Run it with:

```bash
pnpm --filter livestore-example-client-only-events-init-apis dev
```

The app groups the routes by whether defaults are client-only or derived from source data:

- `client-only/store-boot`
- `client-only/render-ensure`
- `client-only/route-loader-ensure/inbox`
- `derived/default-with-readiness-marker`
