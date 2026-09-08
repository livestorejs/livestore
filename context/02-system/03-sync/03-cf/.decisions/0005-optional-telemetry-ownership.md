# 0005 — Keep sync telemetry optional and scope exporter ownership to bounded work

Status: accepted (user confirmation, 2026-09-08, to implement optional telemetry injection
and explicit lifecycle ownership while preserving Cloudflare Free support).

## Context

The store accepts an application tracer, while the Cloudflare sync backend only
accepted an OTLP endpoint and constructed its own exporter. Applications could
not reuse their tracing setup there. WebSocket subscriptions deliberately remain
open across hibernation, making connection shutdown an unsuitable export boundary.

## Decision

Accept an application-owned OTel provider directly, with no additional flush options.
Use its optional `forceFlush()` method in the background after finite sync work.
Install the Effect bridge locally without registering or shutting down a global
provider. Preserve endpoint-based configuration as a mutually exclusive convenience.
Finish telemetry scopes around WebSocket pushes and finite pull history before
entering the live subscription phase. Explicit finite WebSocket boundaries attach
to the caller rather than an unexported Effect RPC envelope. Wrap DO-RPC pull
streams inside their separate execution runtime, as well as the outer handler.

Cloudflare-native tracing and managed export remain optional deployment features.
They are not dependencies of this integration. Platform-neutral OTel injection
preserves the application's choice of exporter and destination.

## Alternatives

- Requiring Cloudflare's managed drain would exclude Workers Free and couple
  library instrumentation to a platform beta.
- Owning the application's provider would risk shutting down unrelated traces.
- A connection-wide exporter scope would retain timers across idle subscriptions
  or depend on shutdown callbacks the runtime does not provide.

## Consequences

Export runs in the background and flush failures do not change sync outcomes.
LiveStore bounds its wait to three seconds but cannot cancel app-owned promises.
Only one provider flush runs per DO instance at a time; completions during a flush
request a trailing pass, including when a slow flush eventually settles.
Delivery is best-effort rather than a durable telemetry queue. Application-owned
providers manage their own resources; LiveStore-owned endpoint exporters close
in separate scopes so their shutdown cannot delay acknowledgments.

## Evidence

`packages/@livestore/sync-cf/src/cf-worker/do/observability.test.ts` verifies
opt-out, injected parentage, ownership, flush error isolation, acknowledgment
while export is blocked, slow flush coalescing, and
finite-history cleanup before a never-ending live stream.
Cloudflare documents the absence of shutdown hooks and the effect of timers on
hibernation in its [DO lifecycle reference](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).
