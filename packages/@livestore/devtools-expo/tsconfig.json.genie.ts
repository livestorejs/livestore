import { packageTsconfigCompilerOptions, reactJsx, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
    verbatimModuleSyntax: true,
  },
  include: ['./src', 'src/types.d.ts'],
  references: [{ path: '../adapter-web' }, { path: '../adapter-node' }, { path: '../utils' }],
})
