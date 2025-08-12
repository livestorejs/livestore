# Code Snippets in Docs

## Expressive Code Twoslash

- We're using [Expressive Code Twoslash](https://twoslash.matthiesen.dev) for code snippets.
- Goals:
  - Snippets should always be up to date and valid/runnable.
  - Keep larger snippets in separate `.ts` files in `src/content/_assets/code/` to make them easier to maintain.
- Best practices:
  - Avoid using TS workarounds like `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`, `as any` etc.
  - Don't use `// @errors: 18004` etc to suppress errors.
  - Avoid using `declare` as workarounds but rather prefer proper imports.
  - Packages that are imported from should be installed as `devDependencies` in the `docs` package.json.
  - Use explicit `.ts` and `.tsx` extensions for relative file imports.

### Multi-file Snippets

Use the `?snippet` import for multi-file Twoslash examples:

```mdx
import workerSnippet from '../../_assets/code/getting-started/react-web/livestore.worker.ts?snippet'

<Code lang="ts" meta="twoslash" code={workerSnippet} title="src/livestore.worker.ts" />
```

This automatically:
- Recursively includes all `.ts` and `.tsx` files from the directory and subdirectories
- Adds `@filename` directives with `src/` prefix for each file
- Orders files intelligently:
  - `.d.ts` files come first (for type declarations)
  - Files in subdirectories come before files that import them
  - Alphabetical order within the same depth level
- Places `---cut---` before the main imported file (to show only that file by default)
- Maintains proper TypeScript compilation for all files

**Important:** When creating multi-file snippets:
- Add `/// <reference types="vite/client" />` at the top of files that use Vite-specific imports (e.g., `?worker`, `?sharedworker`)
- Keep imports between files relative with explicit extensions (e.g., `./livestore/schema.ts`)
- The plugin preserves directory structure in the virtual file system

Example directory structure:
```
src/content/_assets/code/getting-started/react-web/
├── livestore/
│   └── schema.ts         # Subdirectory files (processed before importers)
├── livestore.worker.ts   # Main file (with ---cut---)
├── Root.tsx             # Add /// <reference types="vite/client" /> for worker imports
├── Header.tsx
└── MainSection.tsx
```

### Configuration

**Vite Plugin**: The `?snippet` functionality is implemented via `docs/src/vite-plugin-snippet.js` which is registered in `docs/astro.config.mjs`.

**Expressive Code**: See `docs/ec.config.mjs` for Twoslash configuration:
- TypeScript compiler options include `allowImportingTsExtensions: true` and `moduleResolution: Bundler`
- JSX is configured for React

### Testing

- Make sure the snippets are type checked and linted.
- Make sure the `astro` build passes.
