---
"@livestore/common-cf": patch
---

Fix a Durable-Object-as-LiveStore-client sync head that could permanently freeze after a cold-boot catchup over the DO-RPC transport. The DO-RPC client shared one stateful msgpack parser across every call. Because Cloudflare splits a streamed response into ~4KB reads that don't align with msgpack frames, a catchup-pull frame straddles two reads; a concurrent push-response decode interleaved between those reads could clobber the parser's stashed partial frame, dropping the rest of the catchup and freezing sync below the eventlog head. The client now creates one parser per request/response (matching `RpcClient.makeProtocolHttp`), so the incomplete-frame buffer is never shared across concurrent calls. ([#1266](https://github.com/livestorejs/livestore/pull/1266))
