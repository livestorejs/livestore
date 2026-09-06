---
'@livestore/common': minor
'@livestore/adapter-web': patch
---

Retry interrupted state rebuilds from clean derived state. Record completion only
after replay and all migration hooks succeed, preserving the eventlog and pending
events. The new fingerprinted system table causes a one-time state rebuild on
upgrade from a pre-marker version, including Cloudflare replay time and row writes.
Migration hooks may run again after interruption and must tolerate retries.
Browser fast-path startup rejects incomplete snapshots and waits for leader recovery.

Fixes https://github.com/livestorejs/livestore/issues/1605.
