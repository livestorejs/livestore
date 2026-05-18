import { baseTsconfigCompilerOptions, domLib, packageTsconfigExclude, refs, tsconfigJson } from '../../../genie/repo.ts'

/**
 * Svelte package test tsconfig.
 * Separate from main tsconfig to avoid including test files in the build.
 * Non-composite (noEmit) since tests are run directly.
 * Includes DOM lib for jsdom-based testing.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    lib: domLib, // Need DOM for jsdom-based tests
    noEmit: true,
    composite: false,
    rootDir: '.',
  },
  include: ['./tests/**/*.ts', './tests/**/*.svelte', './tests/**/*.d.ts'],
  exclude: ['./tests/vitest.config.ts', ...packageTsconfigExclude],
  references: [refs.common, refs.adapterWeb, refs.livestore, refs.utils, refs.utilsDev],
})
