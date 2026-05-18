import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    composite: true,
    rootDir: '.',
    outDir: 'dist',
    tsBuildInfoFile: './dist/.tsbuildinfo',
    types: ['node'],
  },
  include: ['src'],
  exclude: [...packageTsconfigExclude],
})
