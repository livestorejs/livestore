import {
  baseTsconfigCompilerOptions,
  domLib,
  nodeTypes,
  packageTsconfigExclude,
  tsconfigJson,
} from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...nodeTypes,
    lib: domLib,
    noEmit: true,
  },
  include: ['test'],
  exclude: [...packageTsconfigExclude],
  references: [{ path: '../../packages/@livestore/wa-sqlite' }],
})
