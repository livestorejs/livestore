import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    resolveJsonModule: true,
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.common, refs.utils, refs.webmesh, refs.sqliteWasm],
})
