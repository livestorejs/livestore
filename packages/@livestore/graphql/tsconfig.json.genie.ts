import { packageTsconfigCompilerOptions, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
  },
  include: ['./src'],
  references: [{ path: '../utils' }, { path: '../livestore' }, { path: '../common' }],
})
