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
  // Note: We intentionally don't use tsconfig references to @local packages here.
  // Using references causes TS2742 errors because TypeScript follows the references
  // and resolves types from the referenced packages' node_modules, leading to
  // non-portable type paths in inferred declarations.
  references: [
    { path: '../packages/@livestore/utils' },
    { path: '../packages/@livestore/utils-dev' },
    { path: '../packages/@livestore/common' },
  ],
})
