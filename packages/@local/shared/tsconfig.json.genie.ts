import {
  baseTsconfigCompilerOptions,
  nodeTypes,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    ...nodeTypes,
    rootDir: '.',
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
})
