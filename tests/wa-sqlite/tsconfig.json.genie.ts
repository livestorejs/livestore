import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    noEmit: true,
  },
  include: ['test'],
  exclude: [...packageTsconfigExclude],
  references: [{ path: '../../packages/@livestore/wa-sqlite' }],
})
