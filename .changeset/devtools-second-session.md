---
'@livestore/react': patch
---

Keep a suspended `useStore` attempt's promise through React replay, then return to synchronous cached-store reads after the first successful render. This prevents concurrent render recovery from booting duplicate stores with identical DevTools mesh identities.

Use the persisted adapter's shared client identity in DevTools multi-tab fixtures, assert independent in-memory databases and reload behavior, and keep the TodoMVC store registry stable across aborted route renders to avoid duplicate DevTools mesh node IDs.
