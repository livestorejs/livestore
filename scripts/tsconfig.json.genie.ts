import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../genie/repo.ts'

/**
 * Scripts tsconfig - CLI tools for the monorepo.
 *
 * Key design decisions:
 * - `noEmit: true` - Scripts are run directly with bun/tsx, not compiled
 * - `declaration: false` - Prevents TS2742 errors from cross-workspace type resolution
 * - `composite: false` - Scripts doesn't participate in project references build
 *
 * Why declaration: false?
 * Scripts imports from @local packages (docs tools, test utils) which are in its
 * pnpm workspace. When pnpm deduplicates dependencies, it may symlink Effect packages
 * to docs/node_modules. TypeScript then tries to reference these paths in declarations,
 * triggering TS2742 "type cannot be named without a reference to..." errors.
 * Since scripts is a CLI tool (not a library), it doesn't need to emit declarations.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    resolveJsonModule: true,
    // CLI tool - doesn't emit, doesn't need portable declarations
    noEmit: true,
    declaration: false,
    declarationMap: false,
    composite: false,
  },
  include: ['./src', './standalone'],
  exclude: [...packageTsconfigExclude],
  references: [
    { path: '../packages/@livestore/utils' },
    { path: '../packages/@livestore/utils-dev' },
    { path: '../packages/@livestore/common' },
    { path: '../packages/@local/astro-tldraw' },
    { path: '../packages/@local/astro-twoslash-code' },
    { path: '../tests/integration' },
    { path: '../tests/sync-provider' },
  ],
})
