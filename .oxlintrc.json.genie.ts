import { baseOxlintCategories, baseOxlintIgnorePatterns, baseOxlintPlugins, oxlintConfig } from './genie/repo.ts'

/**
 * LiveStore oxlint configuration (Phase 1 — permissive).
 *
 * This introduces oxlint (replacing Biome) with a deliberately permissive rule set
 * to avoid massive code churn during the initial migration. Deferred rules retain
 * their rationale below for incremental re-enablement.
 */

// ── Active rules ────────────────────────────────────────────────────────────

const activeRules = {
  // Disallow CommonJS (require/module.exports) — enforce ESM everywhere
  'import/no-commonjs': 'error',
  // Enforce proper type-only imports
  'typescript/consistent-type-imports': 'warn',
  // Enforce explicit boolean comparisons in condition positions
  'overeng/explicit-boolean-compare': 'warn',
  // Keep Biome-era lint behavior that diverges from oxlint defaults.
  'no-param-reassign': 'error',
  'default-param-last': 'error',
  'typescript/prefer-enum-initializers': 'error',
  'react/self-closing-comp': 'error',
  'typescript/prefer-namespace-keyword': 'error',
  'typescript/no-inferrable-types': 'error',
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
  // Legacy rule; React 17+ automatic JSX runtime doesn't require React in scope
  'react/react-in-jsx-scope': 'off',
} as const

// ── Phase 2 — re-enable after codebase-wide fixes ───────────────────────────

const phase2Rules = {
  'func-style': 'error',
  // 18 violations — eliminate barrel files in favor of mod.ts
  'oxc/no-barrel-file': 'off',

  // 77 violations — false positives with ?worker imports
  'import/default': 'off',
  // 4 violations — madge already covers circular deps
  'import/no-cycle': 'off',
  // 15 violations — evaluate dynamic require usage
  'import/no-dynamic-require': 'off',
  // 35 violations — side-effect imports are valid in some contexts
  'import/no-unassigned-import': 'off',
  // 2 violations — namespace import false positives
  'import/namespace': 'off',
  // 2 violations — named-as-default false positives
  'import/no-named-as-default': 'off',

  'react-perf/jsx-no-new-function-as-prop': 'error',
  'react-perf/jsx-no-new-object-as-prop': 'error',
  'react-perf/jsx-no-jsx-as-prop': 'error',
  'react-perf/jsx-no-new-array-as-prop': 'error',

  // 447 violations — false positives in Effect generators
  'block-scoped-var': 'off',
  // 186 violations — sequential await is intentional in many cases
  'no-await-in-loop': 'off',
  // 141 violations — false positives with Effect pipe patterns
  'no-unused-expressions': 'off',
  // 21 violations — false positives with Effect.fn(function* ...)
  'require-yield': 'off',

  // 28 violations — postMessage target origin
  'unicorn/require-post-message-target-origin': 'off',
  // 28 violations — addEventListener vs onX
  'unicorn/prefer-add-event-listener': 'off',
  // 4 violations — empty files
  'unicorn/no-empty-file': 'off',

  // ~567 violations; disabled temporarily to unblock CI (https://github.com/livestorejs/livestore/issues/1057)
  'typescript/no-unsafe-type-assertion': 'off',
  // Inverse of overeng/explicit-boolean-compare — must stay off
  'typescript/no-unnecessary-boolean-literal-compare': 'off',
  // Re-enable after the upstream tsgolint crash is fixed.
  // Currently triggers a nil pointer panic in tsgolint/typescript-go.
  'typescript/no-unnecessary-type-arguments': 'off',
  // 72 violations, concentrated in generated clients and broad union types
  'typescript/no-duplicate-type-constituents': 'error',
  // 57 violations, assertion cleanup churn
  'typescript/no-unnecessary-type-assertion': 'error',
  // 42 violations, noisy with Effect error/rendering types
  'typescript/restrict-template-expressions': 'error',

  // Temporary quick-check unblocking; re-enable after the async audit
  // 78 violations concentrated in wa-sqlite and test surfaces
  'typescript/no-floating-promises': 'off',

  // Re-enable low-risk style hygiene rules first
  // 16 violations, mostly logging/debug stringification quality
  'typescript/no-base-to-string': 'error',
  // 11 violations, low-risk type hygiene noise
  'typescript/no-redundant-type-constituents': 'error',
  // 4 violations, mostly template readability nits
  'typescript/no-unnecessary-template-expression': 'error',
  // 4 violations, mostly Effect wrappers around void-returning APIs
  'typescript/no-meaningless-void-operator': 'error',

  // Temporary unblock for correctness-sensitive rules
  // Re-enable after targeted async/this-binding/prototype-safety fixes.
  'typescript/unbound-method': 'off',
  'typescript/no-misused-spread': 'off',
  'typescript/no-for-in-array': 'off',

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

export const livestoreOxlintRules = {
  ...activeRules,
  ...permanentlyDisabledRules,
  ...phase2Rules,
}

/**
 * LiveStore-specific overrides (without overeng rules).
 * Based on effect-utils overrides but excluding overeng/* rules.
 */
export const livestoreOxlintOverrides = [
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
      // Re-enable after the wa-sqlite async API audit.
      'typescript/await-thenable': 'off',
      'unicorn/no-new-array': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'overeng/explicit-boolean-compare': 'off',
      'no-param-reassign': 'off',
    },
  },

  // Svelte files need relaxed rules until oxlint fully supports them
  {
    files: ['**/*.svelte'],
    rules: { 'import/no-unassigned-import': 'off' },
  },
] as const

export const livestoreOxlintPlugins = [...baseOxlintPlugins, 'react', 'react-perf'] as const
export const livestoreOxlintCategories = baseOxlintCategories
export const livestoreOxlintIgnorePatterns = [
  ...baseOxlintIgnorePatterns,
  'tests/integration/node_modules/**',
  'docs/src/plugins/**',
] as const

export default oxlintConfig({
  plugins: livestoreOxlintPlugins,
  categories: livestoreOxlintCategories,
  rules: livestoreOxlintRules,
  overrides: livestoreOxlintOverrides,
  ignorePatterns: livestoreOxlintIgnorePatterns,
})
