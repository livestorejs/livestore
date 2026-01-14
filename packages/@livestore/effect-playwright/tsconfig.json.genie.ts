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
  references: [refs.utils],
})
