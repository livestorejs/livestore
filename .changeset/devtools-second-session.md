---
'@livestore/react': patch
---

Keep a suspended `useStore` attempt's promise until the component commits, including when a later hook suspends again. Clear only the committed attempt, then return to synchronous cached-store reads on mounted updates so action transitions can commit. This prevents React replay from confusing sequential stores or recovering from hook-order errors.

Use the persisted adapter's shared client identity in DevTools multi-tab fixtures, assert independent in-memory databases and reload behavior, and keep the TodoMVC store registry stable across aborted route renders to avoid duplicate DevTools mesh node IDs.
