# Linearlite Example

[Demo](https://web-linearlite.livestore.dev/)

## Cloudflare Sync (optional)

This app can sync via Cloudflare Durable Objects, mirroring the TodoMVC CF example.

Steps:

- Start the Cloudflare Worker locally
  - cd examples/web-linearlite
  - pnpm wrangler:dev
  - This serves the backend on `http://localhost:8787`

- Run the app with the sync URL
  - fish-compatible: `env VITE_LIVESTORE_SYNC_URL=http://localhost:8787 pnpm dev`
  - Alternatively rely on the dev server plugin that auto-starts Wrangler during `pnpm dev`.

The app passes `syncPayload` with a demo token; adjust validation in `src/cf-worker/index.ts` for real auth.
