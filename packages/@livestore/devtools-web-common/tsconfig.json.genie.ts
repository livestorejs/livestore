import { packageTsconfigCompilerOptions, reactJsx, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
  },
  include: ['./src'],
  references: [{ path: '../common' }, { path: '../utils' }, { path: '../webmesh' }],
})
