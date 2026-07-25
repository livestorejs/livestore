---
'@livestore/utils': patch
---

Use OpenTelemetry's canonical invalid span context for no-op spans, avoiding a platform-specific ID generator that Metro could not resolve through a package self-import.
