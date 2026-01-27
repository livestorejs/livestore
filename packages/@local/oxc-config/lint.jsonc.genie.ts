import { oxlintConfig } from '../../../genie/repo.ts'

export default oxlintConfig({
  plugins: ['import', 'typescript', 'unicorn', 'oxc', 'react', 'react-perf'],
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    pedantic: 'off',
    perf: 'warn',
    style: 'off',
    restriction: 'off',
  },
  rules: {
    /** Disallow dynamic import() and require() - helps with static analysis and bundling */
    'import/no-dynamic-require': ['warn', { esmodule: true }],

    /** Disallow re-exports except in mod.ts entry points */
    'oxc/no-barrel-file': ['warn', { threshold: 0 }],

    /** Disallow CommonJS (require/module.exports) - enforce ESM */
    'import/no-commonjs': 'error',

    /** Detect circular dependencies */
    'import/no-cycle': 'warn',

    /** Prefer function expressions over declarations */
    'func-style': ['warn', 'expression', { allowArrowFunctions: true }],

    /** Enforce proper type imports and disallow inline import() in type annotations */
    'typescript/consistent-type-imports': 'warn',

    /** Don't enforce type vs interface - both are fine */
    'typescript/consistent-type-definitions': 'off',

    /** Disable rules that conflict with Effect patterns */
    'unicorn/no-array-callback-reference': 'off',

    /** Don't enforce explicit any (already enforced by TypeScript strict mode) */
    'typescript/no-explicit-any': 'off',

    /** Given we're publishing a library, we can't enforce this rule */
    'typescript/no-deprecated': 'off',
  },
  overrides: [
    /** Allow re-exports in mod.ts and index.ts entry point files */
    {
      files: ['**/mod.ts', '**/index.ts'],
      rules: {
        'oxc/no-barrel-file': 'off',
      },
    },
    /** Test files have more relaxed rules */
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/test/**',
        '**/tests/**',
      ],
      rules: {
        'unicorn/no-array-sort': 'off',
        'unicorn/consistent-function-scoping': 'off',
        /** Effect tests often use Effect.gen without yields for consistency */
        'require-yield': 'off',
      },
    },
    /** Declaration files can use inline import() type annotations */
    {
      files: ['**/*.d.ts'],
      rules: {
        'typescript/consistent-type-imports': 'off',
      },
    },
    /** Generated files should not be linted for style/structure rules */
    {
      files: ['**/*.gen.*', '**/.astro/**', '**/routeTree.gen.ts'],
      rules: {
        'func-style': 'off',
        'import/no-commonjs': 'off',
        'import/no-named-as-default': 'off',
        'import/no-unassigned-import': 'off',
        'oxc/no-barrel-file': 'off',
        'oxc/no-map-spread': 'off',
        'unicorn/consistent-function-scoping': 'off',
      },
    },
    /** Config files don't need strict rules */
    {
      files: ['**/vitest.config.ts', '**/vite.config.ts', '**/playwright.config.ts', '**/*.genie.ts'],
      rules: {
        'func-style': 'off',
      },
    },
    /** wa-sqlite is a fork with its own style */
    {
      files: ['**/wa-sqlite/**'],
      rules: {
        'func-style': 'off',
        'import/no-commonjs': 'off',
        'unicorn/no-new-array': 'off',
        'unicorn/no-array-sort': 'off',
        'unicorn/consistent-function-scoping': 'off',
      },
    },
    /** Svelte files need relaxed rules until oxlint fully supports them */
    {
      files: ['**/*.svelte'],
      rules: {
        'import/no-unassigned-import': 'off',
      },
    },
  ],
  ignorePatterns: [
    '**/node_modules/**',
    '**/.pnpm/**',
    '**/.pnpm-store/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.wrangler/**',
    '**/.vercel/**',
    '**/.netlify/**',
    '**/.astro/**',
    '**/.nitro/**',
    '**/.tanstack/**',
    '**/.direnv/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/nix/**',
    '**/wip/**',
    '**/.vite/**',
    '**/patches/**',
    '**/.cache/**',
    '**/.turbo/**',
  ],
})
