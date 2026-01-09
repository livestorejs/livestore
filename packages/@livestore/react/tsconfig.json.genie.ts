import { packageTsconfigCompilerOptions, reactJsx, refs, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
  },
  include: ['./src'],
  references: [refs.common, refs.adapterWeb, refs.livestore, refs.utils, refs.utilsDev],
})
