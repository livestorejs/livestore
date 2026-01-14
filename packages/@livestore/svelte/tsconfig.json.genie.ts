import {
  livestoreBaseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
  },
  include: ['./src'],
  references: [refs.common, refs.adapterWeb, refs.livestore, refs.utils, refs.utilsDev],
})
