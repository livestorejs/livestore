# Multi State Todo Example

This example demonstrates one LiveStore store instance using multiple SQLite state backends simultaneously.

## What it shows

- A single schema with two SQLite backends (`a` and `b`)
- Backend-specific events and materializers routed through one store
- Two independent todo lists rendered on the same page

## Running locally

```bash
pnpm install
pnpm dev
```

## Optional reset

In development, append `?reset=1` to clear persisted OPFS state before boot.
