---
'@livestore/sync-cf': patch
---

Raise the Cloudflare sync transport payload budget to 28 MiB, leaving 4 MiB of headroom below Cloudflare's received-message limit.
