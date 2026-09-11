---
'@livestore/sync-cf': minor
---

Allow Cloudflare sync backends to use an optional application-supplied Effect
tracer layer via `otel: layer`. Existing OTLP endpoint configuration remains
supported. Finalize telemetry in the background without delaying sync
acknowledgments, and export finite WebSocket and DO-RPC pull spans before live
subscriptions wait. Preserve sampled client context, start a backend trace when
client context is unsampled, and keep expected sync-recovery responses out of
boundary error telemetry. Platform-specific tracing packages stay in the
application.
