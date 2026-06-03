---
"@livestore/livestore": minor
---

Removed the Client Document API and `SessionIdSymbol`. Use regular SQLite tables with explicit client-only events, materializers, and `queryDb` queries for persisted local state; pass `store.sessionId` explicitly when modeling session-scoped state.
