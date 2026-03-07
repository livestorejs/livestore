import { tsconfigJson } from '../../../../../../../../genie/repo.ts'
import { sharedCompilerOptions } from '../../../../tsconfig.shared.ts'

export default tsconfigJson({
  compilerOptions: {
    ...sharedCompilerOptions,
    module: 'ESNext',
    moduleResolution: 'Bundler',
    rootDir: './',
    jsx: 'react-jsx',
    types: ['node'],
    noEmit: true,
  },
  include: ['./**/*.ts', './**/*.tsx', './**/*.d.ts'],
  exclude: ['./node_modules'],
})
