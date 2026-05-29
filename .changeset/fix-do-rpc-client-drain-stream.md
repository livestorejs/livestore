---
"@livestore/common-cf": patch
---

Harden the Durable Object RPC client stream decoder against frame-straddling. `processReadableStream` now drains the entire streaming response into a single buffer and decodes it once, instead of decoding each `reader.read()` chunk individually. Cloudflare DO RPC splits stream bytes at arbitrary (~4KB) boundaries that do not align with msgpack frames; relying on the serializer's stateful incomplete-frame recovery was observed to silently drop the tail of multi-chunk catchup payloads in the workerd runtime, stalling a Durable-Object-as-LiveStore-client sync head. Decoding a complete buffer removes that dependency (#1170).
