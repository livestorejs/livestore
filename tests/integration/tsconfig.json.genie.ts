import { baseTsconfigCompilerOptions, packageTsconfigExclude, reactJsx, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    composite: true,
    exactOptionalPropertyTypes: false,
    outDir: './dist',
    rootDir: '.',
    resolveJsonModule: true,
    ...reactJsx,
    tsBuildInfoFile: './dist/.tsbuildinfo',
    types: ['@cloudflare/workers-types'],
  },
  include: ['./src', './scripts'],
  exclude: [...packageTsconfigExclude, './src/tests/devtools/fixtures'],
  references: [
    { path: '../../packages/@local/shared' },
    { path: '../../packages/@livestore/effect-playwright' },
    { path: '../../packages/@livestore/common' },
    { path: '../../packages/@livestore/react' },
    { path: '../../packages/@livestore/livestore' },
    { path: '../../packages/@livestore/adapter-node' },
    { path: '../../packages/@livestore/sync-cf' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
    { path: '../../packages/@livestore/adapter-web' },
  ],
})
