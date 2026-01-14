import {
  livestoreBaseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  refs,
  solidJsx,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    ...solidJsx,
  },
  include: ['./src'],
  references: [refs.common, refs.livestore, refs.utils],
})
