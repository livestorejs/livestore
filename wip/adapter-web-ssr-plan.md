# LiveStore Web Adapter SSR Support Plan

## Context
- Goal: revive the prior SSR support proposal for `@livestore/adapter-web` and prepare the ground for future React Server Components (RSC) support.
- Constraints: avoid breaking the existing browser adapter bundle and keep SSR-specific dependencies out of the default entry point.
- Strategy: introduce a dedicated SSR entry in the web adapter that reuses the already battle-tested Node adapter internals for single-threaded, in-memory execution during server rendering.

## Implementation Plan
1. **Reusable Node Adapter Wrapper**
   - Add a new `makeSsrAdapter` helper under `packages/@livestore/adapter-web/src/ssr`.
   - Internally call the single-threaded Node adapter (`@livestore/adapter-node`) with an in-memory storage configuration.
   - Provide ergonomic options for supplying `importSnapshot`, `clientId`, `sessionId`, and optional `sync` configuration (for future streaming or prefetch scenarios).
   - Guard against accidental usage in a browser environment (e.g. throw a descriptive error when `window` is defined).

2. **Package Exports & Dependencies**
   - Extend the web adapter `package.json` exports with a new `./ssr` subpath.
   - Declare the dependency on `@livestore/adapter-node` so the wrapper can reuse its implementation.
   - Ensure publish config mirrors the new export.

3. **Type Surface**
   - Re-export `NodeAdapterOptions` (and related storage types if needed) from `@livestore/adapter-node` so the SSR wrapper can reference them without deep imports.
   - Define SSR-specific option types that deliberately expose only the subset needed for server rendering.

4. **Docs & Dev Experience**
   - Update README or add a follow-up task (tbd) describing how to consume the new SSR entry (e.g. Next.js `app/` routes example).
   - Confirm there are no bundler regressions by ensuring the default adapter entry remains browser-only.

## Open Questions
- Should we allow persisted (filesystem) storage for SSR, or restrict to in-memory snapshots? (Current plan keeps both pathways via the Node adapter but defaults to in-memory.)
- How should SSR snapshots be produced/consumed across requests? Do we need helper utilities for serialising the snapshot into the HTML payload?
- For future RSC support, do we need a lightweight leader thread proxy that can operate without full sync capabilities? (Might require further abstraction of leader-thread creation.)
- Do we want to automatically no-op devtools wiring on the server, or expose a flag to tunnel messages back to a development workstation?
- Testing story: is a unit test sufficient (e.g. verifying snapshot import) or do we need an integration harness that renders through React SSR?

