# @local/astro-twoslash-code

Utilities for rendering multi-file Expressive Code / Twoslash snippets in Astro projects. The package encapsulates the build pipeline, Vite loader, and Astro components used by the LiveStore docs so the workflow can be reused and tested independently.

## What It Provides

- **Astro integration** `createAstroTwoslashCodeIntegration()` that registers the snippet Vite plugin with LiveStore's conventions and keeps Twoslash artefacts warm during dev/build.
- **Vite plugin** `createTwoslashSnippetPlugin()` and helpers for advanced setups.
- **Effect CLI** helpers `buildSnippets()` / `createSnippetsCommand()` to pre-render snippets and write cache artefacts.
- **UI primitives** `MultiCode.astro` (+ utilities) for rendering tabbed multi-file snippets.
- **Shared conventions** for cache locations, snippet workspace layout, and rebuild messaging.

## Features

- TypeScript-aware Twoslash snippets with diagnostics
- Real TypeScript build step for your code snippets to validate

## Conventions & Layout

All paths are resolved relative to the Astro project root (usually the directory containing `astro.config.*`). The layout is intentionally fixed so different apps share the same structure:

| Purpose | Path |
| --- | --- |
| Snippet sources | `src/content/_assets/code/` |
| Twoslash cache artefacts | `node_modules/.astro-twoslash-code/` |
| Twoslash manifest | `node_modules/.astro-twoslash-code/manifest.json` |
| Expressive Code config | Managed internally by the integration |

Additional expectations:

- Snippet entry files live underneath `src/content/_assets/code/`. Relative imports and triple-slash references must stay within that tree.
- Snippet TypeScript options default to `src/content/_assets/code/tsconfig.json`. Override the location or patch compiler options via the `runtime` option if you need custom behaviour.
- The rebuild command defaults to `mono docs snippets build`; override it when embedding into other projects so error messages point to the correct script.

### Canonical snippet paths

`buildSnippetBundle` and `renderSnippet` now operate on canonical POSIX-relative paths (e.g. `reference/solid-integration/livestore/store.ts`). The helpers strip leading `./` prefixes and normalise `../` segments before passing filenames to Twoslash. This keeps TypeScript’s module resolution aligned with the paths declared in `// @filename` blocks and removes the need for duplicate aliases. UI components derive display labels from the same canonical value, so there is a single source of truth for both the compiler and the renderer.

### Snippet test catalog

The `src/cli/test-fixtures/catalog/` directory provides a minimal set of snippet workspaces that mirror the real docs (basic imports, worker loaders, and the Solid integration flow). The Vitest suite exercises the full render pipeline with those fixtures to guard against path-regression bugs such as the `./schema.ts` resolution issue.

## Usage

### 1. Register the Integration

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import { createAstroTwoslashCodeIntegration } from '@local/astro-twoslash-code/integration'

const snippetRuntime = {
  compilerOptions: {
    moduleResolution: 'Bundler',
  },
}

export default defineConfig({
  integrations: [
    createAstroTwoslashCodeIntegration({
      runtime: snippetRuntime,
    }),
  ],
})
```

The integration injects the Vite plugin so snippet imports resolve to cached artefacts:

- `?snippet` returns a ready-to-render Astro component that wraps `<MultiCode />` for you.
- `?snippet-raw` exposes the underlying payload (files, diagnostics, styles) for tooling and custom renderers.

Share the same `snippetRuntime` object with your CLI script to keep the integration and build pipeline in sync. Leaving `runtime` undefined restores the defaults from the table above.

By default the integration runs the snippet build once when the Astro dev server boots and again before `astro build`. Disable this with `autoBuild: false`, tweak inputs via `buildOptions`, or set `LS_TWOSLASH_SKIP_AUTO_BUILD=1` when you invoke Astro manually.

```ts
createAstroTwoslashCodeIntegration({
  autoBuild: false,
  buildOptions: {
    projectRoot: fileURLToPath(new URL('./docs', import.meta.url)),
  },
})
```

### 2. Pre-render Snippets

```ts
// scripts/build-snippets.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { buildSnippets } from '@local/astro-twoslash-code'

const snippetRuntime = {
  compilerOptions: {
    moduleResolution: 'Bundler',
  },
}

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

PlatformNode.NodeRuntime.runMain(
  buildSnippets({ projectRoot, runtime: snippetRuntime }).pipe(
    Effect.provide(PlatformNode.NodeFileSystem.layer),
  ),
)
```

Wire this script into the project (e.g. `pnpm snippets:build`). The CLI caches each rendered bundle and logs `Rendered X snippet bundles (Y cache hits)` after every run, so a warm build prints something like `Rendered 0 snippet bundles (43 cache hits)`. The Vite plugin validates hashes at runtime and fails fast if the cache is missing or stale, so keep this command in your pipeline even when the integration’s auto-build is enabled.

### 3. Render Snippets

```mdx
import BasicSnippet, { snippetData as basicSnippetData } from '../../content/_assets/code/basic/main.ts?snippet'

<BasicSnippet class="mt-6" />
```

The named `snippetData` export mirrors the structure returned by `?snippet-raw`, so existing tooling can keep using the raw payload while templates render the component directly.

## Example Project

`packages/@local/astro-twoslash-code/example` is a minimal Astro app that uses the integration, prebuild script, and Playwright test to exercise the full workflow. Run:

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
- `MultiCode` component helper (`prepareMultiCodeData`)
- `TwoslashRuntimeOptions` / `ExpressiveCodePluginDescriptor` types for custom runtime wiring

See the TypeScript source in `src/` for exact option shapes.
