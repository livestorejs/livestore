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
    types: ['vitest/globals', '@types/node'],
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [
    { path: '../../packages/@livestore/common' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
    { path: '../../packages/@livestore/sqlite-wasm' },
  ],
})
