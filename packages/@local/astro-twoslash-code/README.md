# @local/astro-twoslash-code

Utilities for rendering multi-file Expressive Code / Twoslash snippets in Astro projects. The package encapsulates the build pipeline, Vite loader, and Astro components used by the LiveStore docs so the workflow can be reused and tested independently.

## What It Provides

- **Astro integration** `createAstroTwoslashCodeIntegration()` that registers the snippet Vite plugin with LiveStore's conventions.
- **Vite plugin** `createTwoslashSnippetPlugin()` and helpers for advanced setups.
- **Effect CLI** helpers `buildSnippets()` / `createSnippetsCommand()` to pre-render snippets and write cache artefacts.
- **UI primitives** `MultiCode.astro` (+ utilities) for rendering tabbed multi-file snippets.
- **Shared conventions** for cache locations, snippet workspace layout, and rebuild messaging.

## Conventions & Layout

All paths are resolved relative to the Astro project root (usually the directory containing `astro.config.*`). The layout is intentionally fixed so different apps share the same structure:

| Purpose | Path |
| --- | --- |
| Snippet sources | `src/content/_assets/code/` |
| Twoslash cache artefacts | `.cache/snippets/` |
| Twoslash manifest | `.cache/snippets/manifest.json` |
| Expressive Code config | `ec.config.mjs` |

Additional expectations:

- Snippet entry files live underneath `src/content/_assets/code/`. Relative imports and triple-slash references must stay within that tree.
- `ec.config.mjs` should point Expressive Code/Twoslash at the snippet workspace (see the example project below for a minimal configuration).
- The rebuild command defaults to `mono docs snippets build`; override it when embedding into other projects so error messages point to the correct script.

## Usage

### 1. Register the Integration

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import { createAstroTwoslashCodeIntegration } from '@local/astro-twoslash-code/integration'

export default defineConfig({
  integrations: [
    createAstroTwoslashCodeIntegration({ rebuildCommand: 'pnpm snippets:build' }),
  ],
})
```

The integration injects the Vite plugin so `?snippet` imports resolve to cached artefacts. It assumes the defaults listed in the table above.

### 2. Pre-render Snippets

```ts
// scripts/build-snippets.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSnippets } from '@local/astro-twoslash-code'
import { PlatformNode } from '@livestore/utils/node'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

PlatformNode.NodeRuntime.runMain(
  buildSnippets({ projectRoot, rebuildCommand: 'pnpm snippets:build' }),
)
```

Wire this script into the project (e.g. `pnpm snippets:build`). The Vite plugin validates hashes at runtime and fails fast if the cache is missing or stale, so make this part of your build pipeline.

### 3. Render Snippets

```mdx
import MultiCode from '@local/astro-twoslash-code/components/MultiCode.astro'
import entry from '../../content/_assets/code/basic/main.ts?snippet'

<MultiCode code={entry} />
```

`code` must be the default export from a `?snippet` import. The component displays tabs per file, injects any emitted styles/scripts, and falls back to raw source plus diagnostics when pre-rendering fails.

## Example Project

`examples/astro-twoslash-code-demo` is a minimal Astro app that uses the integration, prebuild script, and Playwright test to exercise the full workflow. Run:

```bash
pnpm install
pnpm --filter @local/astro-twoslash-code-demo snippets:build
pnpm --filter @local/astro-twoslash-code-demo dev
```

To execute the regression test:

```bash
pnpm --filter @local/astro-twoslash-code-demo test
```

## API Surface

- `createAstroTwoslashCodeIntegration(options?)`
- `createTwoslashSnippetPlugin(options?)`
- `buildSnippets(options?)`
- `createSnippetsCommand(options?)`
- `MultiCode` component and helpers (`prepareMultiCodeData`, `setTwoslashExtras`, etc.)

See the TypeScript source in `src/` for exact option shapes.
