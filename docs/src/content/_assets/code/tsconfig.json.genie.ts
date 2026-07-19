import { baseTsconfigCompilerOptions, domLib, reactJsx, tsconfigJson } from '../../../../../genie/repo.ts'

/**
 * Docs code snippets tsconfig.
 * Used for TypeScript snippets embedded in documentation.
 * Uses noEmit since these are just for type checking/editor support.
 * Includes DOM lib since snippets may use browser APIs.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    // This fixture project intentionally composes current workspace packages with
    // published LiveStore/Effect Atom packages that use an older @effect/platform.
    plugins: [
      {
        ...baseTsconfigCompilerOptions.plugins[0],
        allowedDuplicatedPackages: [
          ...baseTsconfigCompilerOptions.plugins[0].allowedDuplicatedPackages,
          '@effect/platform',
        ],
      },
    ],
    lib: [...domLib],
    rootDir: './',
    ...reactJsx,
    types: ['vite/client', 'node', '@cloudflare/workers-types', '@types/react', '@types/react-dom'],
    noEmit: true,
    declaration: false,
    declarationMap: false,
  },
  include: ['./**/*.ts', './**/*.tsx', './**/*.d.ts'],
  exclude: [
    './node_modules',
    './dist',
    '**/*.genie.ts',
    './getting-started/expo/**',
    './getting-started/node/**',
    './reference/framework-integrations/solid/**',
    './reference/framework-integrations/svelte/**',
    './reference/platform-adapters/expo-adapter/**',
    './reference/platform-adapters/node-adapter/**',
    './reference/store/create-store.ts',
    './reference/store/effect/**',
    './reference/syncing/s2/**',
    './reference/syncing/server-side-clients/**',
    './reference/syncing/sync-provider/electricsql/**',
  ],
  references: [
    { path: '../../../../../packages/@livestore/adapter-cloudflare' },
    { path: '../../../../../packages/@livestore/adapter-web' },
    { path: '../../../../../packages/@livestore/common' },
    { path: '../../../../../packages/@livestore/livestore' },
    { path: '../../../../../packages/@livestore/react' },
    { path: '../../../../../packages/@livestore/sync-cf' },
    { path: '../../../../../packages/@livestore/utils' },
  ],
})
