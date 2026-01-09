import { packageTsconfigCompilerOptions, reactJsx, refs, tsconfigJSON } from '../../../genie/repo.ts'

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
