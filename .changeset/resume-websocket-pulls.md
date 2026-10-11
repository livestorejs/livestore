---
'@livestore/sync-cf': patch
---

Fixed live WebSocket pulls stopping after a socket disconnect. Pulls resume after reconnect without a page reload. HTTP transport failures also surface as offline so pulls can retry, while protocol failures remain terminal. See [#1650](https://github.com/livestorejs/livestore/issues/1650), and thanks @bohdanbirdie for the analysis.
