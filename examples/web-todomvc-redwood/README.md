# TodoMVC Redwood Example

This example wires the LiveStore TodoMVC components into the Redwood SDK (rwsdk) worker + client runtime.

## Running locally

```bash
pnpm install
pnpm --filter livestore-example-web-todomvc-redwood dev
```

The Redwood dev server chooses its own port; watch the terminal output for the correct URL.

## Known issues
- `rwsdk@1.0.0-beta.12` currently expects React 19.3 canary builds. To keep the monorepo aligned we pin React/React DOM/React Server DOM to 19.1.0 instead, which triggers peer-dependency warnings during `pnpm install` and may surface runtime incompatibilities.
- `@cloudflare/vite-plugin@1.13.10` requires `wrangler >= 4.42.0`, whereas the workspace catalog still standardises on 4.38.0. Local development works but the mismatch shows up as a peer warning.
- The Starter's worker configuration is included verbatim; we have not validated deployment to Cloudflare or RSC behaviour yet.

Run the smoke test locally with `pnpm --filter livestore-example-web-todomvc-redwood test:e2e`.

## To-do

- [x] Make SSR work properly with LiveStore initialization
