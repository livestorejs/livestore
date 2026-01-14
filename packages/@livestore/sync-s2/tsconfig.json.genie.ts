import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, refs, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    composite: true,
  },
  include: ['./src'],
  references: [refs.common, refs.utils],
})
