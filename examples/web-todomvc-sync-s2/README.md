# TodoMVC + LiveStore (S2)

This example uses TanStack Start + React and syncs with S2 via `@livestore/sync-s2`.

- Dev: pnpm dev
- Build: pnpm build
- Preview: pnpm start
- E2E: pnpm test:e2e

## Environment Variables

### Option 1: Hosted S2 (s2.dev)

```bash
export S2_ACCESS_TOKEN="your-token"  # Required for hosted S2
export S2_BASIN="ls-examples"        # Optional, defaults to "ls-examples"
```

### Option 2: S2-Lite (self-hosted)

Start s2-lite locally:
```bash
docker run -p 8080:80 ghcr.io/s2-streamstore/s2-lite
```

Then configure the example:
```bash
export S2_ENDPOINT="http://localhost:8080"  # Enables s2-lite mode
export S2_BASIN="my-basin"                   # Your basin name
# S2_ACCESS_TOKEN not required (defaults to "redundant")
```

When `S2_ENDPOINT` is set, the example uses s2-lite mode with `S2-Basin` header routing.
