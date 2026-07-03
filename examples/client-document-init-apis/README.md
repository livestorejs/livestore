# Client document initialization APIs

Visual comparison app for explicit LiveStore client-document initialization patterns.

Run it with:

```bash
pnpm --filter livestore-example-client-document-init-apis dev
```

The app groups the routes by whether defaults are client-only or derived from source data:

- `client-only/boot-ensure`
- `client-only/ensure-client-document-suspense-boundary`
- `client-only/use-ensure-client-documents-suspense`
- `client-only/route-loader-ensure/inbox`
- `derived/default-with-readiness-marker`
