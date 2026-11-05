---
'@livestore/webmesh': patch
---

Wait for acknowledged direct-channel handshakes without a scheduling-sensitive 10ms retry deadline, and keep internal ping/pong messages out of application listeners. This prevents slow DevTools extension startup from failing a session. A non-answering peer waits until caller interruption or scope closure. See [#262](https://github.com/livestorejs/livestore/issues/262).
