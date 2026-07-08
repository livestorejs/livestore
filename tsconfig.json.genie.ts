import { baseTsconfigCompilerOptions, tsconfigJson } from './genie/repo.ts'

/**
 * Root TypeScript check config for repository-level tooling files.
 *
 * Package source is checked through `tsconfig.dev.json`. This config adds the
 * tool configs that live outside package `src` roots without pulling docs into
 * the TypeScript project graph; docs remain covered by Astro's checker.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    lib: ['ES2024'],
    declaration: false,
    declarationMap: false,
    module: 'ESNext',
    moduleDetection: 'force',
    moduleResolution: 'Bundler',
    noEmit: true,
    plugins: [],
    rootDir: '.',
    sourceMap: false,
    types: ['node'],
  },
  include: [
    './vitest.config.ts',
    './packages/*/*/vitest.config.ts',
    './scripts/vitest.config.ts',
    './tests/*/playwright.config.ts',
    './tests/*/vitest.config.ts',
    './tests/integration/src/tests/devtools/fixtures/*/vite.config.ts',
  ],
  exclude: ['node_modules', '**/dist', '**/node_modules/.pnpm'],
})
