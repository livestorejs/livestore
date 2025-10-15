# TodoMVC React Router Example

This example mirrors the LiveStore TodoMVC app but uses React Router v7 instead of hash-based anchors.

## Running locally

```bash
pnpm install
pnpm --filter livestore-example-web-todomvc-react-router dev
```

Then open http://localhost:60001.

## Notes
- Navigation routes (`/`, `/active`, `/completed`) stay in sync with the LiveStore filter state.
- Run the smoke test with `pnpm --filter livestore-example-web-todomvc-react-router test:e2e`.
