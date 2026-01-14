import { livestoreBaseTsconfigCompilerOptions, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    noEmit: true,
  },
  include: ['test'],
  exclude: ['node_modules', '**/dist'],
  references: [{ path: '../../packages/@livestore/wa-sqlite' }],
})
