import {
  livestoreBaseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  reactJsx,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
    verbatimModuleSyntax: true,
  },
  include: ['./src', 'src/types.d.ts'],
  references: [refs.adapterWeb, refs.adapterNode, refs.utils],
})
