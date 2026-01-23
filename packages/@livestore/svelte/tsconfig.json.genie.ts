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
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.common, refs.adapterWeb, refs.livestore, refs.utils, refs.utilsDev],
})
