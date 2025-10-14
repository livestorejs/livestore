# Problem: Vite SSR schema evaluation fails with "invoke was called before connect"

## Problem Statement
Running `mono examples run web-linearlite` triggers a Vite SSR evaluation error while loading `examples/web-linearlite/src/livestore/schema/index.ts`. The devtools plugin reports `LiveStore.UnexpectedError` with underlying cause `Error: invoke was called before connect`.

## Expected Behaviour
- Example should start successfully.
- Devtools plugin should be able to evaluate the schema file without runtime errors.

## Actual Behaviour
- Vite forces re-optimisation and then fails to evaluate the schema file.
- Console output:
  ```
  2:48:11 PM [vite] (ssr) Error when evaluating SSR module /home/schickling/code/worktrees/livestore/schickling--2025-10-10-cf-vite/examples/web-linearlite/src/livestore/schema/index.ts: invoke was called before connect
  ```
- Devtools plugin logs an unexpected error with the same cause.

## Reproduction Steps
1. Navigate to the repo at `/home/schickling/code/worktrees/livestore/schickling--2025-10-10-cf-vite`.
2. Run `mono examples run web-linearlite`.
3. Observe Vite re-run and crash during SSR evaluation of the schema module.

## Evidence
- Full log excerpt provided by the user (2025-10-14 14:48 CEST).
