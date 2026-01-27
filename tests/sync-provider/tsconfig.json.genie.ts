import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    composite: true,
    exactOptionalPropertyTypes: false,
    outDir: './dist',
    rootDir: './src',
    resolveJsonModule: true,
    tsBuildInfoFile: './dist/.tsbuildinfo',
    types: ['vitest/globals', '@types/node', '@cloudflare/workers-types'],
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [
    { path: '../../packages/@livestore/common' },
    { path: '../../packages/@livestore/common-cf' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
    { path: '../../packages/@livestore/sqlite-wasm' },
    { path: '../../packages/@livestore/adapter-node' },
    { path: '../../packages/@livestore/adapter-cloudflare' },
    { path: '../../packages/@livestore/sync-cf' },
    { path: '../../packages/@livestore/sync-electric' },
    { path: '../../packages/@livestore/livestore' },
  ],
})
