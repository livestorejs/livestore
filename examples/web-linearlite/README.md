# Linearlite Example

[Demo](https://web-linearlite.livestore.dev/)

## Local development

The app now runs both the UI and Cloudflare Sync worker through the single Vite dev server provided by [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/). No extra Wrangler process is needed while iterating.

```bash
pnpm install
pnpm --filter livestore-example-web-linearlite run dev
```

The dev server automatically forwards sync calls to the worker bundle and exposes the WebSocket endpoint on the same origin. When you need to target a remote worker instead, set `VITE_LIVESTORE_SYNC_URL`.

## Cloudflare worker (optional)

You can still run the Cloudflare worker yourself when you need direct access to the Wrangler inspector or want to point the app at a different backend.

- cd examples/web-linearlite
- pnpm --filter livestore-example-web-linearlite run wrangler:dev
  - This serves the backend on `http://localhost:8787`
- Run the app with that backend:
  - fish-compatible: `env VITE_LIVESTORE_SYNC_URL=http://localhost:8787 pnpm --filter livestore-example-web-linearlite run dev`
  - Or rely on the dev server plugin that auto-starts Wrangler during `pnpm --filter livestore-example-web-linearlite run dev`

The app passes `syncPayload` with a demo token; adjust validation in `src/cf-worker/index.ts` for real auth.

## Building / deploying

```bash
pnpm --filter livestore-example-web-linearlite run build
pnpm --filter livestore-example-web-linearlite run wrangler:deploy
```

The build command emits both the web assets and the worker script that the deploy step uploads to Cloudflare using `wrangler@4.42.2`.
