import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  reactJsx,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    ...reactJsx,
    verbatimModuleSyntax: true,
  },
  include: ['./src', 'src/types.d.ts'],
  exclude: [...packageTsconfigExclude],
  references: [refs.adapterWeb, refs.adapterNode, refs.utils],
})
