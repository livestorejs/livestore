import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, refs, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    exactOptionalPropertyTypes: false,
    target: 'es2022',
  },
  include: ['./src'],
  references: [refs.common, refs.utils, refs.commonCf],
})
