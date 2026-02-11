import { baseOxfmtIgnorePatterns, baseOxfmtOptions } from './repos/effect-utils/genie/oxfmt-base.ts'
import { oxfmtConfig } from './repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

export default oxfmtConfig({
  ...baseOxfmtOptions,

  // LiveStore uses 120 char width (base is 100)
  printWidth: 120,

  // Override import sorting for livestore packages
  experimentalSortImports: {
    ...baseOxfmtOptions.experimentalSortImports,
    internalPattern: ['@livestore/', '@local/'],
  },

  ignorePatterns: [
    ...baseOxfmtIgnorePatterns,
    '**/node_modules/**',
    '**/.pnpm/**',
    '**/.pnpm-store/**',
    'tests/integration/node_modules/**',
    // Exclude MDX files — oxfmt has idempotency issues with MDX formatting
    '**/*.mdx',
    // Exclude Astro-generated type definitions — Astro regenerates these in its own style
    'docs/.astro/**',
    // Exclude Netlify build artifacts — bundled .mjs files trigger oxfmt sort_imports panic (oxc#17788)
    // TODO(oep-c28): Remove once oxfmt ≥0.24.0 lands in nixpkgs (also add **/.netlify/** to effect-utils base)
    'docs/.netlify/**',
    // Phase 1: Skip library source files to avoid biome↔oxfmt formatting flip-flop.
    // These files are biome-formatted to keep the PR #996 diff minimal.
    // TODO(oep-lp9): Remove these ignores when completing the oxfmt migration.
    'packages/@livestore/*/src/**',
    'packages/@livestore/*/test/**',
    'tests/**',
  ],
})
