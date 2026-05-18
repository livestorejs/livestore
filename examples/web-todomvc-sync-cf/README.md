# TodoMVC Example

[Demo](https://example-web-todomvc-sync-cf.livestore.workers.dev)

## Running locally

```bash
pnpm install
pnpm --filter examples/web-todomvc-sync-cf dev
```

The Cloudflare Vite plugin starts both the React front-end and the Durable Object
sync backend on the same dev server port. The app automatically targets the
worker running alongside the Vite dev server, so no additional configuration is
required for local development.
