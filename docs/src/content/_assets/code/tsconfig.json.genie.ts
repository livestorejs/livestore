import { baseTsconfigCompilerOptions, domLib, reactJsx, tsconfigJson } from '../../../../../genie/repo.ts'

/**
 * Docs code snippets tsconfig.
 * Used for TypeScript snippets embedded in documentation.
 * Non-composite (noEmit) since these are just for type checking/editor support.
 * Includes DOM lib since snippets may use browser APIs.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    lib: [...domLib],
    rootDir: './',
    baseUrl: './',
    ...reactJsx,
    types: ['vite/client', 'node', '@cloudflare/workers-types'],
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
  },
  include: ['./**/*.ts', './**/*.tsx', './**/*.d.ts'],
  exclude: ['./node_modules', './dist', '**/*.genie.ts'],
  references: [
    { path: '../../../../../packages/@livestore/adapter-web' },
    { path: '../../../../../packages/@livestore/adapter-expo' },
    { path: '../../../../../packages/@livestore/adapter-cloudflare' },
    { path: '../../../../../packages/@livestore/common' },
    { path: '../../../../../packages/@livestore/livestore' },
    { path: '../../../../../packages/@livestore/solid' },
    { path: '../../../../../packages/@livestore/sync-cf' },
    { path: '../../../../../packages/@livestore/sync-s2' },
    { path: '../../../../../packages/@livestore/utils' },
    { path: '../../../../../packages/@livestore/react' },
  ],
})
