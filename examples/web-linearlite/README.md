# Linearlite Example

[Demo](https://web-linearlite.livestore.dev/)

## Local development

The app now runs both the UI and Cloudflare Sync worker through the single Vite dev server provided by [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/). No extra Wrangler process is needed while iterating.

```bash
pnpm install
pnpm --filter livestore-example-web-linearlite run dev
```

The dev server automatically forwards sync calls to the worker bundle and exposes the WebSocket endpoint on the same origin. When you need to target a remote worker instead, set `VITE_LIVESTORE_SYNC_URL`.

## Building / deploying

```bash
pnpm --filter livestore-example-web-linearlite run build
pnpm --filter livestore-example-web-linearlite run wrangler:deploy
```

The build command emits both the web assets and the worker script that the deploy step uploads to Cloudflare using `wrangler@4.42.2`.
