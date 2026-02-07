import {
  baseOxlintCategories,
  baseOxlintIgnorePatterns,
  baseOxlintPlugins,
} from './repos/effect-utils/genie/external.ts'
import { oxlintConfig } from './repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

/**
 * LiveStore oxlint configuration (Phase 1 — permissive).
 *
 * This introduces oxlint (replacing Biome) with a deliberately permissive rule set
 * to avoid massive code churn during the initial migration. Rules are disabled with
 * TODO references to the follow-up epic oep-1n3 for incremental re-enablement.
 *
 * Unlike effect-utils, we don't use the custom overeng oxlint plugin (which requires
 * a custom-built oxlint binary). We use the standard npm oxlint package instead.
 * Therefore, we exclude all `overeng/*` rules that are present in baseOxlintRules.
 */

// ── Active rules ────────────────────────────────────────────────────────────

const activeRules = {
  // Disallow CommonJS (require/module.exports) — enforce ESM everywhere
  'import/no-commonjs': 'error',
  // Enforce proper type-only imports
  'typescript/consistent-type-imports': 'warn',
} as const

// ── Permanently disabled (incompatible with Effect / livestore patterns) ────

const permanentlyDisabledRules = {
  // Effect uses point-free callback references extensively
  'unicorn/no-array-callback-reference': 'off',
  // TypeScript strict mode already handles this
  'typescript/no-explicit-any': 'off',
  // Library consumers may need older APIs
  'typescript/no-deprecated': 'off',
  // Both type & interface are fine in this codebase
  'typescript/consistent-type-definitions': 'off',
  // TypeScript noUnusedLocals handles this
  'no-unused-vars': 'off',
  // Not enforced in livestore
  eqeqeq: 'off',
} as const

// ── TODO(oep-1n3): Phase 2 — re-enable after codebase-wide fixes ───────────

const phase2Rules = {
  // TODO(oep-1n3.1): 93 violations — migrate function declarations to arrow expressions
  'func-style': 'off',
  // TODO(oep-1n3.6): 18 violations — eliminate barrel files in favor of mod.ts
  'oxc/no-barrel-file': 'off',

  // TODO(oep-1n3.5): 77 violations — false positives with ?worker imports
  'import/default': 'off',
  // TODO(oep-1n3.5): 4 violations — madge already covers circular deps
  'import/no-cycle': 'off',
  // TODO(oep-1n3.5): 15 violations — evaluate dynamic require usage
  'import/no-dynamic-require': 'off',
  // TODO(oep-1n3.5): 35 violations — side-effect imports are valid in some contexts
  'import/no-unassigned-import': 'off',
  // TODO(oep-1n3.5): 2 violations — namespace import false positives
  'import/namespace': 'off',
  // TODO(oep-1n3.5): 2 violations — named-as-default false positives
  'import/no-named-as-default': 'off',

  // TODO(oep-1n3.2): 1028 violations — not needed with modern JSX transform (React 17+)
  'react/react-in-jsx-scope': 'off',
  // TODO(oep-1n3.2): 2 violations — style prop object type checking
  'react/style-prop-object': 'off',
  // TODO(oep-1n3.2): 4 violations — needs React-specific context for Effect patterns
  'react-hooks/exhaustive-deps': 'off',

  // TODO(oep-1n3.3): 276 violations — inline functions as JSX props
  'react-perf/jsx-no-new-function-as-prop': 'off',
  // TODO(oep-1n3.3): 136 violations — inline objects as JSX props
  'react-perf/jsx-no-new-object-as-prop': 'off',
  // TODO(oep-1n3.3): 58 violations — JSX elements as props
  'react-perf/jsx-no-jsx-as-prop': 'off',
  // TODO(oep-1n3.3): 24 violations — inline arrays as JSX props
  'react-perf/jsx-no-new-array-as-prop': 'off',

  // TODO(oep-1n3.4): 447 violations — false positives in Effect generators
  'block-scoped-var': 'off',
  // TODO(oep-1n3.4): 186 violations — sequential await is intentional in many cases
  'no-await-in-loop': 'off',
  // TODO(oep-1n3.4): 141 violations — false positives with Effect pipe patterns
  'no-unused-expressions': 'off',
  // TODO(oep-1n3.4): 21 violations — false positives with Effect.fn(function* ...)
  'require-yield': 'off',

  // TODO(oep-1n3.7): 28 violations — postMessage target origin
  'unicorn/require-post-message-target-origin': 'off',
  // TODO(oep-1n3.7): 28 violations — addEventListener vs onX
  'unicorn/prefer-add-event-listener': 'off',
  // TODO(oep-1n3.7): 4 violations — empty files
  'unicorn/no-empty-file': 'off',

  // Misc low-count rules from category defaults
  'no-extraneous-class': 'off',
  'triple-slash-reference': 'off',
  'no-new': 'off',
  'no-empty-pattern': 'off',
  'no-useless-catch': 'off',
  'no-unused-private-class-members': 'off',
  'no-unassigned-vars': 'off',
  'no-unneeded-ternary': 'off',
  'no-unexpected-multiline': 'off',
  'no-extend-native': 'off',
  'oxc/only-used-in-recursion': 'off',
  'oxc/const-comparisons': 'off',
  'oxc/no-map-spread': 'off',
  'oxc/no-accumulating-spread': 'off',
  'constructor-super': 'off',
  'react/jsx-key': 'off',
  'unicorn/consistent-function-scoping': 'off',
  'unicorn/no-new-array': 'off',
  // False positives resolving exports from external packages
  'import/named': 'off',
  'import/export': 'off',
} as const

const livestoreOxlintRules = {
  ...activeRules,
  ...permanentlyDisabledRules,
  ...phase2Rules,
}

/**
 * LiveStore-specific overrides (without overeng rules).
 * Based on effect-utils overrides but excluding overeng/* rules.
 */
const livestoreOxlintOverrides = [
  // CommonJS files legitimately use require/module.exports
  {
    files: ['**/*.cjs', '**/*.cts', '**/*.js'],
    rules: { 'import/no-commonjs': 'off' },
  },

  // Doc code snippets may demonstrate CJS patterns (e.g., metro.config)
  {
    files: ['**/docs/src/content/_assets/code/**'],
    rules: { 'import/no-commonjs': 'off' },
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
  ignorePatterns: [...baseOxlintIgnorePatterns, 'tests/integration/node_modules/**', 'docs/src/plugins/**'],
})
