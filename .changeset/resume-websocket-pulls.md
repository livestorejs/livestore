---
'@livestore/sync-cf': patch
'@livestore/common': patch
---

Fixed live WebSocket pulls stopping after a socket disconnect. Pulls resume after reconnect without a page reload. HTTP transport failures also surface as offline so pulls can retry, while protocol failures remain terminal. See [#1650](https://github.com/livestorejs/livestore/issues/1650), and thanks @bohdanbirdie for the analysis.

Offline pulls wait for the backend to report connected and then resume immediately, avoiding a tight retry loop or an extra catch-up delay. Jittered exponential fallback probes (1 second doubling to 30 seconds) cover stale connectivity signals.
