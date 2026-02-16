import { tsconfigJson } from '../../../genie/repo.ts'

import baseTsconfig from '../tsconfig.json.genie.ts'

const { include: _include, references: _references, ...baseConfig } = baseTsconfig.data

export default tsconfigJson({
  ...baseConfig,
  compilerOptions: {
    ...baseTsconfig.data.compilerOptions,
    types: ['vite/client'],
  },
  include: ['./src', './vite.config.ts', './index.html', '../src'],
})
