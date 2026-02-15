import { tsconfigJson } from '../../../genie/repo.ts'

import baseTsconfig from '../tsconfig.json.genie.ts'

export default tsconfigJson({
  ...baseTsconfig,
  compilerOptions: {
    ...baseTsconfig.compilerOptions,
    types: ['vite/client'],
  },
  include: ['./src', './vite.config.ts', './index.html', '../src'],
})
