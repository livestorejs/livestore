---
"@livestore/common-cf": patch
---

Fix Durable Object RPC streaming responses being truncated to the first chunk. `createStreamingResponse` now returns the stream-runner promise from `ReadableStream.start()`, so the Cloudflare runtime keeps the stream open until every chunk is enqueued and `close()` is called. Without this, the tail of any multi-chunk catchup payload could be dropped, permanently stalling a Durable-Object-as-LiveStore-client sync head (#1170).
