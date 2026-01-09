import { packageTsconfigCompilerOptions, refs, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    exactOptionalPropertyTypes: false,
    target: 'es2022',
  },
  include: ['./src'],
  references: [refs.common, refs.utils, refs.commonCf],
})
