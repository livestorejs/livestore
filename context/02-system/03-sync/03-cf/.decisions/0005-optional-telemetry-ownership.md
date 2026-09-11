# 0005 — Keep sync telemetry optional and scope exporter ownership to bounded work

Status: accepted (user confirmation, 2026-09-08, including simplification to an
Effect-layer integration).

## Context

The Cloudflare sync backend only accepted an OTLP endpoint and constructed its
own exporter. Applications need to supply their tracing integration, including
Cloudflare-native tracing, without making telemetry mandatory or delaying sync.
WebSocket subscriptions remain open across hibernation, so their closure is not
a suitable export boundary.

## Decision

Accept an optional Effect tracer layer. Preserve the existing endpoint shorthand
by converting it to an Effect OTLP layer. Build the layer per finite operation
and finalize its resources in the background. The integration layer defines its
exporter lifecycle; LiveStore does not manage SDK providers or schedule flushes.

Finish WebSocket telemetry scopes before the indefinite live phase. Give finite
WebSocket work an exported span attached to a sampled caller; start a backend root
when the caller has no sampled context so backend-only telemetry remains visible.
Install tracing inside DO-RPC pull streams' separate runtime. Expected sync
recovery results remain typed failures without marking the RPC boundary as an
OpenTelemetry error. Platform-specific packages stay in the app.

## Alternatives

- Direct SDK-provider injection requires additional flush scheduling, concurrency
  guards, and failure recovery. It is unnecessary when apps supply Effect layers.
- Plain scoped layer provision would wait for exporter cleanup before acknowledging.
- A connection-wide scope can retain exporter timers across idle subscriptions.

## Consequences

Export cleanup cannot delay sync acknowledgments. Layer construction still runs
on the operation path, and a supplied layer must not shut down a shared provider.
The endpoint exporter uses Effect's shutdown timeout. Delivery is best-effort
because Durable Objects provide no eviction or hibernation shutdown callback.

## Evidence

`packages/@livestore/sync-cf/src/cf-worker/do/observability.test.ts` covers opt-out,
independent operation scopes, sampled and unsampled span parentage, expected
recovery status, real WebSocket and DO-RPC transport composition,
finite-history finalization, and acknowledgment while the OTLP collector is
blocked. The disposable Cloudflare demo verified existing LiveStore spans
through `effect-cf` on the Free plan.
