import {
  baseOxlintCategories,
  baseOxlintIgnorePatterns,
  baseOxlintPlugins,
} from './repos/effect-utils/genie/external.ts'
import { oxlintConfig } from './repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

/**
 * LiveStore-specific oxlint rules.
 *
 * Unlike effect-utils, we don't use the custom overeng oxlint plugin (which requires
 * a custom-built oxlint binary). We use the standard npm oxlint package instead.
 * Therefore, we exclude all `overeng/*` rules that are present in baseOxlintRules.
 */
const livestoreOxlintRules = {
  // Disallow dynamic import() and require()
  'import/no-dynamic-require': ['warn', { esmodule: true }],
  // Disallow re-exports except in mod.ts entry points
  'oxc/no-barrel-file': ['warn', { threshold: 0 }],
  // Disallow CommonJS (require/module.exports) - enforce ESM
  'import/no-commonjs': 'error',
  // Detect circular dependencies
  'import/no-cycle': 'warn',
  // Prefer function expressions over declarations
  'func-style': ['warn', 'expression', { allowArrowFunctions: true }],

  // Disable Effect-incompatible rules
  'unicorn/no-array-callback-reference': 'off',

  // Don't enforce explicit any (already enforced by TypeScript strict mode)
  'typescript/no-explicit-any': 'off',

  // Library can't enforce deprecated APIs (consumers may need older versions)
  'typescript/no-deprecated': 'off',

  // Don't enforce type vs interface - both are fine
  'typescript/consistent-type-definitions': 'off',

  // Enforce proper type imports
  'typescript/consistent-type-imports': 'warn',

  // Disable rules not needed in livestore
  'no-unused-vars': 'off', // TypeScript handles this
  eqeqeq: 'off',
} as const

/**
 * LiveStore-specific overrides (without overeng rules).
 * Based on effect-utils overrides but excluding overeng/* rules.
 */
const livestoreOxlintOverrides = [
  // Allow re-exports in mod.ts entry point files
  {
    files: ['**/mod.ts'],
    rules: { 'oxc/no-barrel-file': 'off' },
  },

  // Config files have relaxed rules
  {
    files: ['**/vitest.config.ts', '**/vite.config.ts', '**/playwright.config.ts', '**/*.genie.ts'],
    rules: { 'func-style': 'off' },
  },

  // Test files have more relaxed rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/tests/**'],
    rules: {
      'unicorn/no-array-sort': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'require-yield': 'off',
    },
  },

  // Also allow re-exports in index.ts entry point files
  {
    files: ['**/index.ts'],
    rules: { 'oxc/no-barrel-file': 'off' },
  },

  // Declaration files can use inline import() type annotations
  {
    files: ['**/*.d.ts'],
    rules: { 'typescript/consistent-type-imports': 'off' },
  },

  // Generated files
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

  // wa-sqlite is a fork with its own style
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

  // Svelte files need relaxed rules until oxlint fully supports them
  {
    files: ['**/*.svelte'],
    rules: { 'import/no-unassigned-import': 'off' },
  },
] as const

export default oxlintConfig({
  plugins: [...baseOxlintPlugins, 'react', 'react-perf'],
  categories: baseOxlintCategories,
  rules: livestoreOxlintRules,
  overrides: livestoreOxlintOverrides,
  ignorePatterns: [...baseOxlintIgnorePatterns, 'tests/integration/node_modules/**'],
})
