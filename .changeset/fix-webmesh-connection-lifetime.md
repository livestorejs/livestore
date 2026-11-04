---
'@livestore/webmesh': patch
---

Fix DevTools web sessions getting stuck at "Connecting to session" by keeping worker connections alive until the caller disconnects ([#1709](https://github.com/livestorejs/livestore/pull/1709)).
