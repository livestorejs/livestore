import { tsconfigJson } from './genie/repo.ts'

/**
 * Root tsconfig for development builds.
 * References all packages, tests, docs, and scripts for composite builds.
 */
export default tsconfigJson({
  compilerOptions: {},
  include: [],
  references: [
    // NOTE: docs is excluded from project references - use `astro check` instead
    // { path: './docs' },
    { path: './docs/src/content/_assets/code' },
    { path: './scripts' },
    { path: './packages/@local/astro-tldraw' },
    { path: './packages/@local/astro-twoslash-code' },
    { path: './tests/integration' },
    { path: './tests/package-common' },
    { path: './tests/perf' },
    { path: './tests/sync-provider' },
    { path: './tests/wa-sqlite' },
    { path: './packages/@local/shared' },
    { path: './packages/@livestore/adapter-cloudflare' },
    { path: './packages/@livestore/adapter-web' },
    { path: './packages/@livestore/common' },
    { path: './packages/@livestore/common-cf' },
    { path: './packages/@livestore/effect-playwright' },
    { path: './packages/@livestore/framework-toolkit' },
    { path: './packages/@livestore/livestore' },
    { path: './packages/@livestore/react' },
    { path: './packages/@livestore/sqlite-wasm' },
    { path: './packages/@livestore/sync-cf' },
    { path: './packages/@livestore/utils' },
    { path: './packages/@livestore/utils-dev' },
    { path: './packages/@livestore/webmesh' },
  ],
})
