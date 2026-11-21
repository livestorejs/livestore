---
'@livestore/webmesh': patch
---

Fix DevTools web sessions getting stuck at "Connecting to session" by keeping worker connections alive until the caller disconnects ([#1709](https://github.com/livestorejs/livestore/pull/1709)).

Keep direct-channel control processing available during port readiness, correlate responses with the current negotiation attempt, and release responder registrations when session channels close. Established channels probe newly available routes to discover same-name peer replacements after reload.
