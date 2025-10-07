# Research

- Ran `direnv exec . mono ts` to gather current TypeScript errors.
- Build failed with `TS2353` in `packages/@livestore/solid/src/query.ts` complaining that `onUpdate` is not a known property for the second argument of `store.subscribe`.
- Checked `CHANGELOG.md` which notes that `store.subscribe` API recently changed: callback is now the second positional argument, options moved to third optional object.
- Inspected `query.ts`; it still passes `{ onUpdate: setValue }`, so it uses the pre-change signature.
- The fix likely involves passing the callback directly as the second argument (and only using the third arg for options if needed).
