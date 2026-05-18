## TODO

- [ ] Reuse/import code from examples more directly instead of copying it into this directory. This will require some further work on the `vite-plugin-snippet` to support this (i.e. resolve node_modules from the import example path).

## Dependencies

Use the standalone workspace package here to keep docs dependencies small. Install snippet packages with `pnpm --filter docs-code-snippets add <pkg>` and commit the updated lockfile.

## Type checking

`tsconfig.json` here mirrors the Twoslash compiler options. Use it when you need to run focused TypeScript checks for snippets.
