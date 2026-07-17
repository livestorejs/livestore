import {
  baseTsconfigCompilerOptions,
  domLib,
  packageTsconfigExclude,
  reactJsx,
  tsconfigJson,
} from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    // Playwright browser tests and their in-page fixtures use DOM globals
    // (window, document, MessageEvent, FileSystemFileHandle, …), so pull in the
    // DOM lib on top of the base ES lib set.
    lib: [...domLib],
    composite: true,
    exactOptionalPropertyTypes: false,
    outDir: './dist',
    rootDir: '.',
    resolveJsonModule: true,
    ...reactJsx,
    tsBuildInfoFile: './dist/.tsbuildinfo',
    types: ['@cloudflare/workers-types', '@types/react', '@types/react-dom'],
  },
  include: ['./src', './scripts'],
  exclude: [...packageTsconfigExclude, './src/tests/devtools/fixtures'],
  references: [
    { path: '../../packages/@local/shared' },
    { path: '../../packages/@livestore/effect-playwright' },
    { path: '../../packages/@livestore/adapter-cloudflare' },
    { path: '../../packages/@livestore/common' },
    { path: '../../packages/@livestore/common-cf' },
    { path: '../../packages/@livestore/react' },
    { path: '../../packages/@livestore/livestore' },
    { path: '../../packages/@livestore/sync-cf' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
    { path: '../../packages/@livestore/adapter-web' },
  ],
})
