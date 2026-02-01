import {
  baseOxlintCategories,
  baseOxlintIgnorePatterns,
  baseOxlintPlugins,
  baseOxlintRules,
  configFilesOxlintOverride,
  modEntryOxlintOverride,
  testFilesOxlintOverride,
} from './repos/effect-utils/genie/external.ts'
import { generatedFilesRules } from './repos/effect-utils/genie/oxlint-base.ts'
import { oxlintConfig } from './repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

export default oxlintConfig({
  plugins: [...baseOxlintPlugins, 'react', 'react-perf'],
  categories: baseOxlintCategories,
  rules: {
    ...baseOxlintRules,

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

    // Disable overeng rules (not applicable to livestore)
    'overeng/named-args': 'off',
    'overeng/exports-first': 'off',
    'overeng/jsdoc-require-exports': 'off',

    // Disable rules not needed in livestore
    'no-unused-vars': 'off', // TypeScript handles this
    eqeqeq: 'off',
  },
  overrides: [
    // Base overrides
    modEntryOxlintOverride,
    { ...configFilesOxlintOverride, files: [...configFilesOxlintOverride.files, '**/*.genie.ts'] },
    testFilesOxlintOverride,

    // Also allow re-exports in index.ts entry point files
    {
      files: ['**/index.ts'],
      rules: { 'oxc/no-barrel-file': 'off' },
    },

    // Test files also include **/tests/** pattern
    {
      files: ['**/tests/**'],
      rules: testFilesOxlintOverride.rules,
    },

    // Declaration files can use inline import() type annotations
    {
      files: ['**/*.d.ts'],
      rules: { 'typescript/consistent-type-imports': 'off' },
    },

    // Generated files
    {
      files: ['**/*.gen.*', '**/.astro/**', '**/routeTree.gen.ts'],
      rules: generatedFilesRules,
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
  ],
  ignorePatterns: [...baseOxlintIgnorePatterns, 'tests/integration/node_modules/**'],
})
