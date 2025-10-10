# Cloudflare Vite Plugin Migration Report

## Summary
- Ported `examples/web-todomvc-sync-cf` to the official `@cloudflare/vite-plugin` so the front-end and Durable Object backend now share a single Vite dev server.
- Updated build scripts, runtime configuration defaults, and local development instructions accordingly.

## Friction Encountered
1. **Documentation access** – The Cloudflare developer documentation at <https://developers.cloudflare.com/workers/vite-plugin/> returns HTTP 403 from this environment. I pulled the package tarball from npm to inspect its type definitions and implementation for configuration details instead.
2. **Sync URL defaults** – The previous setup injected `VITE_LIVESTORE_SYNC_URL` via the dev script. With the unified dev server we needed a runtime fallback that derives a WebSocket URL from the current location so both dev and preview modes work without extra configuration. I added a helper in `livestore.worker.ts` to compute this when the environment variable is absent.

## Follow-up Ideas
- Once external documentation is reachable, double-check whether additional plugin options (e.g. `persistState`) would improve the DX for this example.
- Consider adding an integration test that exercises the Vite dev server with the plugin to guard against regressions in future upgrades.
