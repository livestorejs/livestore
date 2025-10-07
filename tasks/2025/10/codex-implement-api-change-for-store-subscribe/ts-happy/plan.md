# Plan

1. Update `packages/@livestore/solid/src/query.ts` to use the new `store.subscribe` signature by passing the setter as the second argument and reserving the third argument for options.
2. Re-run the TypeScript build via `direnv exec . mono ts` to confirm the error is resolved.
3. If other TypeScript issues appear, iterate on them; otherwise proceed to wrap up.
