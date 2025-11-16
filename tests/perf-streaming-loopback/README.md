# LiveStore Streaming Perf Harness (Loopback)

The `perf-streaming-loopback` package hosts a copy of the streaming perf harness wired to an in-process confirmation backend. Instead of proxying through Cloudflare Durable Objects, the app mounts a loopback sync layer powered by `makeMockSyncBackend`, which immediately replays pushed events as confirmed payloads.

## Commands

- `pnpm dev` – run the Vite dev server hitting the loopback backend.
- `pnpm build` – build the React app for production.
- `pnpm preview` – serve the built app locally.

The original Cloudflare-based harness remains in `tests/perf-streaming` if you need to validate behaviour against the real worker transport. This loopback variant is intended for fast local perf profiling without external infrastructure.
