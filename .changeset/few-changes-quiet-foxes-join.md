---
"@livestore/common": patch
---

Always await local push processing in `LeaderSyncProcessor.push` by removing the `waitForProcessing: false` branch, simplifying queue behavior and deferred completion handling.
