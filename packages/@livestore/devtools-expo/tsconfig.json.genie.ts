import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions, reactJsx, refs } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
    verbatimModuleSyntax: true,
  },
  include: ['./src', 'src/types.d.ts'],
  references: [refs.adapterWeb, refs.adapterNode, refs.utils],
})
