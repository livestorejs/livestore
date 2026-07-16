# Observability — Intuition

*For: contributors instrumenting engine paths · Assumes:
[../intuition.md](../intuition.md) · Covers: why LiveStore emits traces into
the app's world instead of owning one*

## A guest in the app's telemetry

LiveStore is a library, not a service — so it never owns exporters, agents,
or endpoints. It emits OpenTelemetry spans for its core operations (boot,
commit, materialization, queries, sync push/pull) *into whatever tracer the
app provides*, so a developer sees "button click → commit → leader push →
backend ack" as one trace next to their own spans. No tracer provided means
a no-op tracer: observability should cost as little as possible when
unused, because the synchronous read path is a performance promise
([../05-store/](../05-store/intuition.md)).

```
app tracer (injected) ◀── spans: boot · commit · materialize · query · sync
no tracer             ◀── NoopTracer (near-zero cost)
```

## Telemetry vs. inspection

This node and [../07-devtools/](../07-devtools/intuition.md) split
"explaining the system" in two: observability is *passive narration*
(traces, structured failure context — what happened, in time order) while
devtools is *active inspection and control* (browse the eventlog now, reset
the database). Today the two are parallel channels: devtools read their own
introspection surface (debug info, query timings, reactivity-graph
snapshots) rather than consuming these traces — converging them is an open
direction, not current behavior.

## Failures should carry their own context

Errors cross boundaries as tagged types annotated with store/client/session
identity — the goal is diagnosing a report without reproducing it. When
adding a failure path, the question to ask: could someone locate the
offending client and operation from this error alone?

This is the thinnest system node today by intent — span naming conventions
and a metrics contract are open questions ([spec.md](./spec.md)), not
missing accidents.
