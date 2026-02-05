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
  ],
})
