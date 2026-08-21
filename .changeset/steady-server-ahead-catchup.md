---
"@livestore/common": patch
---

Actively restart backend pull after `ServerAheadError` so a lost publication cannot permanently fence later pending events.
