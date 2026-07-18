---
"@livestore/common": patch
"@livestore/livestore": patch
"@livestore/utils": patch
---

Prevent SQLite and live-query timing instrumentation from crashing when applications use an OpenTelemetry tracer without SDK-private span timing fields.
