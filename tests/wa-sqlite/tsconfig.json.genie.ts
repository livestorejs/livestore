import { livestoreBaseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    noEmit: true,
  },
  include: ['test'],
  exclude: [...packageTsconfigExclude],
  references: [{ path: '../../packages/@livestore/wa-sqlite' }],
})
