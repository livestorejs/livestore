# Linearlite Example

[Demo](https://web-linearlite.livestore.dev/)

## Local development

The app now runs both the UI and Cloudflare Sync worker through the single Vite dev server provided by [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/). No extra Wrangler process is needed while iterating.

```bash
pnpm install
pnpm --filter livestore-example-web-linearlite run dev
```

The dev server automatically forwards sync calls to the worker bundle and exposes the WebSocket endpoint on the same origin, so the app always connects to the current host without any extra configuration.

## Deploy

This example deploys the Cloudflare Worker (sync backend) **and** the Vite frontend together. A single command builds the client into `dist/client`, bundles the Worker, and uploads both to Cloudflare:

```bash
pnpm --filter livestore-example-web-linearlite run deploy
```

## Building / deploying

```bash
pnpm --filter livestore-example-web-linearlite run build
pnpm --filter livestore-example-web-linearlite run wrangler:deploy
```

The build command emits both the web assets and the worker script that the deploy step uploads to Cloudflare using `wrangler@4.42.2`.
