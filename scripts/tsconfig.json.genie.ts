import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../genie/repo.ts'

/**
 * Scripts tsconfig - CLI tools for the monorepo.
 * Uses noEmit since scripts are run directly with bun/tsx.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    resolveJsonModule: true,
    noEmit: true,
  },
  include: ['./src', './standalone'],
  exclude: [...packageTsconfigExclude],
  references: [
    { path: '../packages/@livestore/utils' },
    { path: '../packages/@livestore/utils-dev' },
    { path: '../tests/sync-provider' },
    { path: '../packages/@livestore/common' },
    { path: '../tests/integration' },
    { path: '../packages/@local/astro-twoslash-code' },
    { path: '../packages/@local/astro-tldraw' },
  ],
})
