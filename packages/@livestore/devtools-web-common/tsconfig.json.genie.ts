import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, reactJsx, refs, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
  },
  include: ['./src'],
  references: [refs.common, refs.utils, refs.webmesh],
})
