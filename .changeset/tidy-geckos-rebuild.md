---
'@livestore/adapter-cloudflare': minor
'@livestore/adapter-web': minor
'@livestore/common': minor
---

Remove the unsupported manual SQLite migration strategy and the now-redundant `strategy: 'auto'` discriminator. Persisted state databases are always keyed by the state schema hash and rebuilt automatically from the eventlog after schema changes; migration configuration now contains only hooks and logging.
