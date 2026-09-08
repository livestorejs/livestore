---
'@livestore/sync-cf': minor
---

Allow Cloudflare sync backends to reuse an application-owned OpenTelemetry
provider via `otel: provider`. Export runs in the background without delaying sync
acknowledgments. LiveStore never registers or shuts down the injected provider.
Existing OTLP endpoint configuration remains supported. Export finite WebSocket
RPC spans and DO-RPC pull spans, closing finite history before live subscription
waits. Telemetry remains opt-in and requires no Cloudflare managed export or
Workers Paid subscription.

Also accept application-supplied Effect tracer layers with per-operation resource
scopes, and preserve queued provider flushes when an earlier export fails.
