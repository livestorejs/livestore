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
  - Declare snippet-only dependencies in `src/content/_assets/code/package.json` so docs dependencies stay lean.
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

### Ambient types and `// ---cut---`

- Use the TwoSlash cut marker `// ---cut---` to hide boilerplate/setup from the rendered snippet while keeping it type-checked.
- Multi-file: ambient declarations live in `*.d.ts` files alongside the snippet. The snippet plugin brings those files in automatically (they are listed before the main file and therefore get trimmed by the cut marker).
- Single-file: add `// ---cut---` at the point where the visible snippet should begin; anything above is hidden.
- Don’t re-declare LiveStore types; import from the real packages or place shared declarations in a local `types.d.ts` if you need ambient helpers.

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

### Dependencies

- Install snippet-only packages via `pnpm --filter docs-code-snippets add <pkg>` so they live in `src/content/_assets/code/package.json`. Don't re-define modules—import from real packages.

### Type checking

- The snippets use `src/content/_assets/code/tsconfig.json`, mirroring the compiler options wired into Twoslash. Use that config if you need to run targeted TypeScript checks for snippet folders.

### Configuration

**Vite Plugin**: The `?snippet` functionality is implemented via `docs/src/vite-plugin-snippet.js` which is registered in `docs/astro.config.mjs`.

**Expressive Code**: See `docs/ec.config.mjs` for Twoslash configuration:
- Twoslash reads `src/content/_assets/code/tsconfig.json`, so compiler options stay aligned with the snippet workspace (NodeNext modules/resolution, React JSX, `node` + `vite/client` types).
- The language-service cache is shared across snippets to avoid re-parsing dependencies.

### Testing

- Make sure the snippets are type checked and linted.
- Make sure the `astro` build passes.
