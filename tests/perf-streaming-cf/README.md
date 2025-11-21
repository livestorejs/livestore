# LiveStore Streaming Perf Harness

The perf-streaming package hosts a minimal React app that exercises the LiveStore event stream against a Cloudflare Durable Object sync backend. A Playwright suite (to be added) will measure latency and memory for confirmed event streaming.

## Commands

- `pnpm dev` – run the Vite dev server with the Cloudflare worker via the wrangler plugin.
- `pnpm build` – build the React app for production.
- `pnpm preview` – serve the built app locally.

The Cloudflare worker is configured in `wrangler.toml` and implements the bare-minimum sync backend hooks required for confirmation semantics.
